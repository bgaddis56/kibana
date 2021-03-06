/*
 * Copyright Elasticsearch B.V. and/or licensed to Elasticsearch B.V. under one
 * or more contributor license agreements. Licensed under the Elastic License;
 * you may not use this file except in compliance with the Elastic License.
 */

import querystring from 'querystring';
import url from 'url';
import { delay } from 'bluebird';
import { getLogoutRequest, getSAMLRequestId, getSAMLResponse } from '../../fixtures/saml_tools';
import expect from 'expect.js';
import request from 'request';

export default function ({ getService }) {
  const chance = getService('chance');
  const supertest = getService('supertestWithoutAuth');
  const config = getService('config');

  const kibanaServerConfig = config.get('servers.kibana');

  function createSAMLResponse(options = {}) {
    return getSAMLResponse({
      destination: `http://localhost:${kibanaServerConfig.port}/api/security/v1/saml`,
      sessionIndex: chance.natural(),
      ...options,
    });
  }

  function createLogoutRequest(options = {}) {
    return getLogoutRequest({
      destination: `http://localhost:${kibanaServerConfig.port}/logout`,
      ...options,
    });
  }

  describe('SAML authentication', () => {
    it('should reject API requests if client is not authenticated', async () => {
      await supertest
        .get('/api/security/v1/me')
        .set('kbn-xsrf', 'xxx')
        .expect(401);
    });

    describe('initiating handshake', () => {
      it('should properly set cookie and redirect user', async () => {
        const handshakeResponse = await supertest.get('/abc/xyz/handshake?one=two three')
          .expect(302);

        const cookies = handshakeResponse.headers['set-cookie'];
        expect(cookies).to.have.length(1);

        const handshakeCookie = request.cookie(cookies[0]);
        expect(handshakeCookie.key).to.be('sid');
        expect(handshakeCookie.value).to.not.be.empty();
        expect(handshakeCookie.path).to.be('/');
        expect(handshakeCookie.httpOnly).to.be(true);

        const redirectURL = url.parse(handshakeResponse.headers.location, true /* parseQueryString */);
        expect(redirectURL.href.startsWith(`https://elastic.co/sso/saml`)).to.be(true);
        expect(redirectURL.query.SAMLRequest).to.not.be.empty();
      });

      it('should not allow access to the API', async () => {
        const handshakeResponse = await supertest.get('/abc/xyz/handshake?one=two three')
          .expect(302);

        const handshakeCookie = request.cookie(handshakeResponse.headers['set-cookie'][0]);
        await supertest
          .get('/api/security/v1/me')
          .set('kbn-xsrf', 'xxx')
          .set('Cookie', handshakeCookie.cookieString())
          .expect(401);
      });

      it('AJAX requests should not initiate handshake', async () => {
        const ajaxResponse = await supertest.get('/abc/xyz/handshake?one=two three')
          .set('kbn-xsrf', 'xxx')
          .expect(401);

        expect(ajaxResponse.headers['set-cookie']).to.be(undefined);
      });
    });

    describe('finishing handshake', () => {
      let handshakeCookie;
      let samlRequestId;

      beforeEach(async () => {
        const handshakeResponse = await supertest.get('/abc/xyz/handshake?one=two three')
          .expect(302);

        handshakeCookie = request.cookie(handshakeResponse.headers['set-cookie'][0]);
        samlRequestId = await getSAMLRequestId(handshakeResponse.headers.location);
      });

      it('should fail if SAML response is not complemented with handshake cookie', async () => {
        await supertest.post('/api/security/v1/saml')
          .set('kbn-xsrf', 'xxx')
          .send({ SAMLResponse: await createSAMLResponse({ inResponseTo: samlRequestId }) }, {})
          .expect(401);
      });

      it('should succeed if both SAML response and handshake cookie are provided', async () => {
        const samlAuthenticationResponse = await supertest.post('/api/security/v1/saml')
          .set('kbn-xsrf', 'xxx')
          .set('Cookie', handshakeCookie.cookieString())
          .send({ SAMLResponse: await createSAMLResponse({ inResponseTo: samlRequestId }) }, {})
          .expect(302);

        // User should be redirected to the URL that initiated handshake.
        expect(samlAuthenticationResponse.headers.location).to.be('/abc/xyz/handshake?one=two%20three');

        const cookies = samlAuthenticationResponse.headers['set-cookie'];
        expect(cookies).to.have.length(1);

        const sessionCookie = request.cookie(cookies[0]);
        expect(sessionCookie.key).to.be('sid');
        expect(sessionCookie.value).to.not.be.empty();
        expect(sessionCookie.path).to.be('/');
        expect(sessionCookie.httpOnly).to.be(true);

        const apiResponse = await supertest
          .get('/api/security/v1/me')
          .set('kbn-xsrf', 'xxx')
          .set('Cookie', sessionCookie.cookieString())
          .expect(200);

        expect(apiResponse.body).to.only.have.keys([
          'username',
          'full_name',
          'email',
          'roles',
          'scope',
          'metadata',
          'enabled',
          'authentication_realm',
          'lookup_realm',
        ]);

        expect(apiResponse.body.username).to.be('a@b.c');
      });

      it('should succeed in case of IdP initiated login', async () => {
        // Don't pass handshake cookie and don't include `inResponseTo` into SAML response
        // to simulate IdP initiated login.
        const samlAuthenticationResponse = await supertest.post('/api/security/v1/saml')
          .set('kbn-xsrf', 'xxx')
          .send({ SAMLResponse: await createSAMLResponse() }, {})
          .expect(302);

        // User should be redirected to the URL that initiated handshake.
        expect(samlAuthenticationResponse.headers.location).to.be('/');

        const cookies = samlAuthenticationResponse.headers['set-cookie'];
        expect(cookies).to.have.length(1);

        const sessionCookie = request.cookie(cookies[0]);
        expect(sessionCookie.key).to.be('sid');
        expect(sessionCookie.value).to.not.be.empty();
        expect(sessionCookie.path).to.be('/');
        expect(sessionCookie.httpOnly).to.be(true);

        const apiResponse = await supertest
          .get('/api/security/v1/me')
          .set('kbn-xsrf', 'xxx')
          .set('Cookie', sessionCookie.cookieString())
          .expect(200);

        expect(apiResponse.body).to.only.have.keys([
          'username',
          'full_name',
          'email',
          'roles',
          'scope',
          'metadata',
          'enabled',
          'authentication_realm',
          'lookup_realm',
        ]);

        expect(apiResponse.body.username).to.be('a@b.c');
      });

      it('should fail if there is an active authenticated session already', async () => {
        const samlAuthenticationResponse = await supertest.post('/api/security/v1/saml')
          .set('kbn-xsrf', 'xxx')
          .set('Cookie', handshakeCookie.cookieString())
          .send({ SAMLResponse: await createSAMLResponse({ inResponseTo: samlRequestId }) }, {})
          .expect(302);

        const sessionCookie = request.cookie(samlAuthenticationResponse.headers['set-cookie'][0]);

        const secondSAMLAuthenticationResponse = await supertest.post('/api/security/v1/saml')
          .set('kbn-xsrf', 'xxx')
          .set('Cookie', sessionCookie.cookieString())
          .send({ SAMLResponse: await createSAMLResponse() }, {})
          .expect(403);

        expect(secondSAMLAuthenticationResponse.body).to.eql({
          error: 'Forbidden',
          message: 'Sorry, you already have an active Kibana session. ' +
          'If you want to start a new one, please logout from the existing session first.',
          statusCode: 403
        });
      });

      it('should fail if SAML response is not valid', async () => {
        await supertest.post('/api/security/v1/saml')
          .set('kbn-xsrf', 'xxx')
          .set('Cookie', handshakeCookie.cookieString())
          .send({ SAMLResponse: await createSAMLResponse({ inResponseTo: 'some-invalid-request-id' }) }, {})
          .expect(401);
      });
    });

    describe('API access with active session', () => {
      let sessionCookie;

      beforeEach(async () => {
        const handshakeResponse = await supertest.get('/abc/xyz')
          .expect(302);

        const handshakeCookie = request.cookie(handshakeResponse.headers['set-cookie'][0]);
        const samlRequestId = await getSAMLRequestId(handshakeResponse.headers.location);

        const samlAuthenticationResponse = await supertest.post('/api/security/v1/saml')
          .set('kbn-xsrf', 'xxx')
          .set('Cookie', handshakeCookie.cookieString())
          .send({ SAMLResponse: await createSAMLResponse({ inResponseTo: samlRequestId }) }, {})
          .expect(302);

        sessionCookie = request.cookie(samlAuthenticationResponse.headers['set-cookie'][0]);
      });

      it('should extend cookie on every successful non-system API call', async () => {
        const apiResponseOne = await supertest
          .get('/api/security/v1/me')
          .set('kbn-xsrf', 'xxx')
          .set('Cookie', sessionCookie.cookieString())
          .expect(200);

        expect(apiResponseOne.headers['set-cookie']).to.not.be(undefined);
        const sessionCookieOne = request.cookie(apiResponseOne.headers['set-cookie'][0]);

        expect(sessionCookieOne.value).to.not.be.empty();
        expect(sessionCookieOne.value).to.not.equal(sessionCookie.value);

        const apiResponseTwo = await supertest
          .get('/api/security/v1/me')
          .set('kbn-xsrf', 'xxx')
          .set('Cookie', sessionCookie.cookieString())
          .expect(200);

        expect(apiResponseTwo.headers['set-cookie']).to.not.be(undefined);
        const sessionCookieTwo = request.cookie(apiResponseTwo.headers['set-cookie'][0]);

        expect(sessionCookieTwo.value).to.not.be.empty();
        expect(sessionCookieTwo.value).to.not.equal(sessionCookieOne.value);
      });

      it('should not extend cookie for system API calls', async () => {
        const systemAPIResponse = await supertest
          .get('/api/security/v1/me')
          .set('kbn-xsrf', 'xxx')
          .set('kbn-system-api', 'true')
          .set('Cookie', sessionCookie.cookieString())
          .expect(200);

        expect(systemAPIResponse.headers['set-cookie']).to.be(undefined);
      });

      it('should fail and preserve session cookie if unsupported authentication schema is used', async () => {
        const apiResponse = await supertest
          .get('/api/security/v1/me')
          .set('kbn-xsrf', 'xxx')
          .set('Authorization', 'Basic AbCdEf')
          .set('Cookie', sessionCookie.cookieString())
          .expect(400);

        expect(apiResponse.headers['set-cookie']).to.be(undefined);
      });
    });

    describe('logging out', () => {
      let sessionCookie;
      let idpSessionIndex;

      beforeEach(async () => {
        const handshakeResponse = await supertest.get('/abc/xyz')
          .expect(302);

        const handshakeCookie = request.cookie(handshakeResponse.headers['set-cookie'][0]);
        const samlRequestId = await getSAMLRequestId(handshakeResponse.headers.location);

        idpSessionIndex = chance.natural();
        const samlAuthenticationResponse = await supertest.post('/api/security/v1/saml')
          .set('kbn-xsrf', 'xxx')
          .set('Cookie', handshakeCookie.cookieString())
          .send({
            SAMLResponse: await createSAMLResponse({ inResponseTo: samlRequestId, sessionIndex: idpSessionIndex })
          }, {})
          .expect(302);

        sessionCookie = request.cookie(samlAuthenticationResponse.headers['set-cookie'][0]);
      });

      it('should redirect to IdP with SAML request to complete logout', async () => {
        const logoutResponse = await supertest.get('/api/security/v1/logout')
          .set('Cookie', sessionCookie.cookieString())
          .expect(302);

        const cookies = logoutResponse.headers['set-cookie'];
        expect(cookies).to.have.length(1);

        const logoutCookie = request.cookie(cookies[0]);
        expect(logoutCookie.key).to.be('sid');
        expect(logoutCookie.value).to.be.empty();
        expect(logoutCookie.path).to.be('/');
        expect(logoutCookie.httpOnly).to.be(true);
        expect(logoutCookie.maxAge).to.be(0);

        const redirectURL = url.parse(logoutResponse.headers.location, true /* parseQueryString */);
        expect(redirectURL.href.startsWith(`https://elastic.co/slo/saml`)).to.be(true);
        expect(redirectURL.query.SAMLRequest).to.not.be.empty();

        // Tokens that were stored in the previous cookie should be invalidated as well and old
        // session cookie should not allow API access.
        const apiResponse = await supertest
          .get('/api/security/v1/me')
          .set('kbn-xsrf', 'xxx')
          .set('Cookie', sessionCookie.cookieString())
          .expect(400);

        expect(apiResponse.body).to.eql({
          error: 'Bad Request',
          message: 'invalid_grant',
          statusCode: 400
        });
      });

      it('should redirect to home page if session cookie is not provided', async () => {
        const logoutResponse = await supertest.get('/api/security/v1/logout')
          .expect(302);

        expect(logoutResponse.headers['set-cookie']).to.be(undefined);
        expect(logoutResponse.headers.location).to.be('/');
      });

      it('should reject AJAX requests', async () => {
        const ajaxResponse = await supertest.get('/api/security/v1/logout')
          .set('kbn-xsrf', 'xxx')
          .set('Cookie', sessionCookie.cookieString())
          .expect(400);

        expect(ajaxResponse.headers['set-cookie']).to.be(undefined);
        expect(ajaxResponse.body).to.eql({
          error: 'Bad Request',
          message: 'Client should be able to process redirect response.',
          statusCode: 400
        });
      });

      it('should invalidate access token on IdP initiated logout', async () => {
        const logoutRequest = await createLogoutRequest({ sessionIndex: idpSessionIndex });
        const logoutResponse = await supertest.get(`/api/security/v1/logout?${querystring.stringify(logoutRequest)}`)
          .set('Cookie', sessionCookie.cookieString())
          .expect(302);

        const cookies = logoutResponse.headers['set-cookie'];
        expect(cookies).to.have.length(1);

        const logoutCookie = request.cookie(cookies[0]);
        expect(logoutCookie.key).to.be('sid');
        expect(logoutCookie.value).to.be.empty();
        expect(logoutCookie.path).to.be('/');
        expect(logoutCookie.httpOnly).to.be(true);
        expect(logoutCookie.maxAge).to.be(0);

        const redirectURL = url.parse(logoutResponse.headers.location, true /* parseQueryString */);
        expect(redirectURL.href.startsWith(`https://elastic.co/slo/saml`)).to.be(true);
        expect(redirectURL.query.SAMLResponse).to.not.be.empty();

        // Tokens that were stored in the previous cookie should be invalidated as well and old session
        // cookie should not allow API access.
        const apiResponse = await supertest
          .get('/api/security/v1/me')
          .set('kbn-xsrf', 'xxx')
          .set('Cookie', sessionCookie.cookieString())
          .expect(400);

        expect(apiResponse.body).to.eql({
          error: 'Bad Request',
          message: 'invalid_grant',
          statusCode: 400
        });
      });

      it('should invalidate access token on IdP initiated logout even if there is no Kibana session', async () => {
        const logoutRequest = await createLogoutRequest({ sessionIndex: idpSessionIndex });
        const logoutResponse = await supertest.get(`/api/security/v1/logout?${querystring.stringify(logoutRequest)}`)
          .expect(302);

        expect(logoutResponse.headers['set-cookie']).to.be(undefined);

        const redirectURL = url.parse(logoutResponse.headers.location, true /* parseQueryString */);
        expect(redirectURL.href.startsWith(`https://elastic.co/slo/saml`)).to.be(true);
        expect(redirectURL.query.SAMLResponse).to.not.be.empty();

        // Elasticsearch should find and invalidate access and refresh tokens that correspond to provided
        // IdP session id (encoded in SAML LogoutRequest) even if Kibana doesn't provide them and session
        // cookie with these tokens should not allow API access.
        const apiResponse = await supertest
          .get('/api/security/v1/me')
          .set('kbn-xsrf', 'xxx')
          .set('Cookie', sessionCookie.cookieString())
          .expect(400);

        expect(apiResponse.body).to.eql({
          error: 'Bad Request',
          message: 'invalid_grant',
          statusCode: 400
        });
      });
    });

    describe('API access with expired access token.', () => {
      let sessionCookie;

      beforeEach(async () => {
        const handshakeResponse = await supertest.get('/abc/xyz')
          .expect(302);

        const handshakeCookie = request.cookie(handshakeResponse.headers['set-cookie'][0]);
        const samlRequestId = await getSAMLRequestId(handshakeResponse.headers.location);

        const samlAuthenticationResponse = await supertest.post('/api/security/v1/saml')
          .set('kbn-xsrf', 'xxx')
          .set('Cookie', handshakeCookie.cookieString())
          .send({ SAMLResponse: await createSAMLResponse({ inResponseTo: samlRequestId }) }, {})
          .expect(302);

        sessionCookie = request.cookie(samlAuthenticationResponse.headers['set-cookie'][0]);
      });

      it('expired access token should be automatically refreshed', async function () {
        this.timeout(40000);

        // Access token expiration is set to 15s for API integration tests.
        // Let's wait for 20s to make sure token expires.
        await delay(20000);

        // This api call should succeed and automatically refresh token. Returned cookie will contain
        // the new access and refresh token pair.
        const apiResponse = await supertest
          .get('/api/security/v1/me')
          .set('kbn-xsrf', 'xxx')
          .set('Cookie', sessionCookie.cookieString())
          .expect(200);

        const cookies = apiResponse.headers['set-cookie'];
        expect(cookies).to.have.length(1);

        const newSessionCookie = request.cookie(cookies[0]);
        expect(newSessionCookie.key).to.be('sid');
        expect(newSessionCookie.value).to.not.be.empty();
        expect(newSessionCookie.path).to.be('/');
        expect(newSessionCookie.httpOnly).to.be(true);
        expect(newSessionCookie.value).to.not.be(sessionCookie.value);

        // Request with old cookie should fail with `400` since it contains expired access token and
        // already used refresh tokens.
        const apiResponseWithExpiredToken = await supertest
          .get('/api/security/v1/me')
          .set('kbn-xsrf', 'xxx')
          .set('Cookie', sessionCookie.cookieString())
          .expect(400);
        expect(apiResponseWithExpiredToken.headers['set-cookie']).to.be(undefined);
        expect(apiResponseWithExpiredToken.body).to.eql({
          error: 'Bad Request',
          message: 'Both access and refresh tokens are expired.',
          statusCode: 400
        });

        // The new cookie with fresh pair of access and refresh tokens should work.
        await supertest
          .get('/api/security/v1/me')
          .set('kbn-xsrf', 'xxx')
          .set('Cookie', newSessionCookie.cookieString())
          .expect(200);
      });

      it('expired access token should be automatically refreshed with two concurrent requests', async function () {
        this.timeout(40000);

        // Access token expiration is set to 15s for API integration tests.
        // Let's wait for 20s to make sure token expires.
        await delay(20000);

        // Issue two concurrent requests with the same cookie that contains expired access token.
        // First request that uses refresh token should succeed, the second should fail since refresh
        // token is one-time use only token.
        const apiResponseOnePromise = supertest
          .get('/api/security/v1/me')
          .set('kbn-xsrf', 'xxx')
          .set('Cookie', sessionCookie.cookieString())
          .expect(200);

        const apiResponseTwoPromise = supertest
          .get('/api/security/v1/me')
          .set('kbn-xsrf', 'xxx')
          .set('Cookie', sessionCookie.cookieString())
          .expect(400);

        const apiResponseOne = await apiResponseOnePromise;
        const cookies = apiResponseOne.headers['set-cookie'];
        expect(cookies).to.have.length(1);

        const newSessionCookie = request.cookie(cookies[0]);
        expect(newSessionCookie.key).to.be('sid');
        expect(newSessionCookie.value).to.not.be.empty();
        expect(newSessionCookie.path).to.be('/');
        expect(newSessionCookie.httpOnly).to.be(true);
        expect(newSessionCookie.value).to.not.be(sessionCookie.value);

        const apiResponseTwo = await apiResponseTwoPromise;
        expect(apiResponseTwo.headers['set-cookie']).to.be(undefined);
        expect(apiResponseTwo.body).to.eql({
          error: 'Bad Request',
          message: 'Both access and refresh tokens are expired.',
          statusCode: 400
        });

        // Request with old cookie should fail with `400` since it contains expired access token and
        // already used refresh tokens.
        const apiResponseWithExpiredToken = await supertest
          .get('/api/security/v1/me')
          .set('kbn-xsrf', 'xxx')
          .set('Cookie', sessionCookie.cookieString())
          .expect(400);
        expect(apiResponseWithExpiredToken.body).to.eql({
          error: 'Bad Request',
          message: 'Both access and refresh tokens are expired.',
          statusCode: 400
        });

        // The new cookie with fresh pair of access and refresh tokens should work.
        await supertest
          .get('/api/security/v1/me')
          .set('kbn-xsrf', 'xxx')
          .set('Cookie', newSessionCookie.cookieString())
          .expect(200);
      });
    });
  });
}
