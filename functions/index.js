'use strict';

const dotenv = require('dotenv').config(); // Loads .env file
const functions = require('firebase-functions');
const admin = require('firebase-admin');
admin.initializeApp();
const express = require('express');
const cookieParser = require('cookie-parser');
const bodyParser = require('body-parser')
const cors = require('cors')({origin: true});
const md5 = require('md5');
const {ApiError, Client, Environment} = require('square');
const axios = require('axios');

const {PORT, SQ_HOST, SQ_SANDBOX_APP_ID, SQ_SANDBOX_APP_SECRET, SQ_SANDBOX_APP_TOKEN} = process.env;
// Check if example secrets were set
if (!SQ_SANDBOX_APP_ID || !SQ_SANDBOX_APP_SECRET) {
  console.warn('\x1b[33m%s\x1b[0m', 'Missing secrets! Configure set values for SQ_SANDBOX_APP_ID and SQ_SANDBOX_APP_SECRET in a .env file.');
  process.exit(1);
}

const port = PORT || "5000";
const messages = require('./sandbox-messages');

// The default environment for this example is sandbox
let basePath = `https://connect.squareupsandbox.com`;

// Configure Square defcault client
const squareClient = new Client({
  environment: Environment.Sandbox
});

// Configure Square OAuth API instance
const oauthInstance = squareClient.oAuthApi;

// INCLUDE PERMISSIONS YOU WANT YOUR SELLER TO GRANT YOUR APPLICATION
const scopes = [
  "ITEMS_READ",
  "MERCHANT_PROFILE_READ",
  "PAYMENTS_WRITE_ADDITIONAL_RECIPIENTS",
  "PAYMENTS_WRITE",
  "PAYMENTS_READ"
];

const app = express();
app.use(cookieParser());
app.use(cors);

/**
 * Description:
 *  Serves the link that merchants click to authorize your application
 */
app.get("/sandbox_request_token", (req, res) => {
  // Set the Auth_State cookie with a random md5 string to protect against cross-site request forgery.
  // Auth_State will expire in 300 seconds (5 mins) after the page is loaded.
  var state = md5(Date.now())
  var url = basePath + `/oauth2/authorize?client_id=${process.env.SQ_SANDBOX_APP_ID}&` + `response_type=code&` + `scope=${scopes.join('+')}` + `&state=` + state
  res.cookie("Auth_State", state, {expire: Date.now() + 300000}).send(
    `<p>
            <a href='${url}'> SANDBOX: Authorize this application</a>
        </p>`
  )
});

/**
 * Description:
 *  Serves requests from Square to your application's redirect URL
 *  Note that you need to set your application's Redirect URL to
 *  http://localhost:8000/sandbox_callback from your application dashboard
 *
 * Query Parameters:
 *  state: the Auth State set in request_token
 *  response_type: the type of the response; should be "code"
 *  code: the authorization code
 */
app.get('/sandbox_callback', async (req, res) => {
  console.log(req.query);
  // Verify the state to protect against cross-site request forgery.
  /* if (req.cookies["Auth_State"] !== req.query['state']) {
    res.send(messages.displayStateError());
  } else */
  if (req.query['error']) {
    // Check to see if the seller clicked the Deny button and handle it as a special case.
    if (("access_denied" === req.query['error']) && ("user_denied" === req.query["error_description"])) {
      res.send(messages.displayError("Authorization denied", "You chose to deny access to the app."));
    }
    // Display the error and description for all other errors.
    else {
      res.send(messages.displayError(req.query["error"], req.query["error_description"]));
    }
  }
    // When the response_type is "code", the seller clicked Allow
  // and the authorization page returned the auth tokens.
  else if ("code" === req.query["response_type"]) {
    // Extract the returned authorization code from the URL
    var {code} = req.query;

    try {
      let {result} = await oauthInstance.obtainToken({
        // Provide the code in a request to the Obtain Token endpoint
        code,
        clientId: process.env.SQ_SANDBOX_APP_ID,
        clientSecret: process.env.SQ_SANDBOX_APP_SECRET,
        grantType: 'authorization_code'
      });

      let {
        // Extract the returned access token from the ObtainTokenResponse object
        accessToken,
        refreshToken,
        expiresAt,
        merchantId
      } = result;

      // Because we want to keep things simple and we're using Sandbox,
      // we call a function that writes the tokens to the page so we can easily copy and use them directly.
      // In production, you should never write tokens to the page. You should encrypt the tokens and handle them securely.
      res.send(messages.writeTokensOnSuccess(accessToken, refreshToken, expiresAt, merchantId));
    } catch (error) {
      // The response from the Obtain Token endpoint did not include an access token. Something went wrong.
      if (error instanceof ApiError) {
        res.send(messages.displayError('Exception', JSON.stringify(error.result)));
      } else {
        res.send(messages.displayError('Exception', JSON.stringify(error)));
      }
    }
  } else {
    // No recognizable parameters were returned.
    res.send(messages.displayError("Unknown parameters", "Expected parameters were not returned"));
  }
});

app.get('/test', (req, res) => {
  // @ts-ignore
  res.send(`Howdy Visitor, v8!`);
});

// Express middleware that validates Firebase ID Tokens passed in the Authorization HTTP header.
// The Firebase ID token needs to be passed as a Bearer token in the Authorization HTTP header like this:
// `Authorization: Bearer <Firebase ID Token>`.
// when decoded successfully, the ID Token content will be added as `req.user`.
const validateFirebaseIdToken = async (req, res, next) => {
  functions.logger.log('Check if request is authorized with Firebase ID token');

  if ((!req.headers.authorization || !req.headers.authorization.startsWith('Bearer ')) &&
    !(req.cookies && req.cookies.__session)) {
    functions.logger.error(
      'No Firebase ID token was passed as a Bearer token in the Authorization header.',
      'Make sure you authorize your request by providing the following HTTP header:',
      'Authorization: Bearer <Firebase ID Token>',
      'or by passing a "__session" cookie.'
    );
    res.status(403).send('Unauthorized');
    return;
  }

  let idToken;
  if (req.headers.authorization && req.headers.authorization.startsWith('Bearer ')) {
    functions.logger.log('Found "Authorization" header');
    // Read the ID Token from the Authorization header.
    idToken = req.headers.authorization.split('Bearer ')[1];
  } else if(req.cookies) {
    functions.logger.log('Found "__session" cookie');
    // Read the ID Token from cookie.
    idToken = req.cookies.__session;
  } else {
    // No cookie
    res.status(403).send('Unauthorized');
    return;
  }

  try {
    const decodedIdToken = await admin.auth().verifyIdToken(idToken);
    functions.logger.log('ID Token correctly decoded', decodedIdToken);
    req.user = decodedIdToken;
    next();
    return;
  } catch (error) {
    functions.logger.error('Error while verifying Firebase ID token:', error);
    res.status(403).send('Unauthorized');
    return;
  }
};

const sqPrepareRequest = () => {
  return axios.create({
    baseURL: `${SQ_HOST}`,
    headers: {
      'Authorization': `Bearer ${SQ_SANDBOX_APP_TOKEN}`,
      'Accepts': 'application/json',
      'Content-Type': 'application/json'
    },
  });
}

const sqPrepareError = (err) => {
  console.log(err);
  let status = 500;
  let statusText = 'Internal Server Error (Back End)';

  if (err.response) {
    status = err.response.status;
    statusText =  err.response.statusText;
  }

  const errResult = {
    code: status,
    message: statusText,
  }

  if (err.response.data) {
    errResult.data = err.response.data;
  }
  return errResult;
}

app.get('/v2/customers', async (req, res) => {
  try {
    const uriSq = `/v2/customers`;
    const sqResult = await sqPrepareRequest().get(uriSq);
    res.status(sqResult.status).json(sqResult.data);
  } catch (err)
  {
    const errResult = sqPrepareError(err);
    res.status(errResult.code).json(errResult);
  }
});

app.get('/v2/orders/:orderId', async (req, res) => {
  try {
    const uriSq = `/v2/orders/${req.params.orderId}`;
    const sqResult = await sqPrepareRequest().get(uriSq);
    res.status(sqResult.status).json(sqResult.data);
  } catch (err)
  {
    const errResult = sqPrepareError(err);
    res.status(errResult.code).json(errResult);
  }
});

app.get('/v2/payments/:paymentId', async (req, res) => {
  try {
    const uriSq = `/v2/payments/${req.params.paymentId}`;
    const sqResult = await sqPrepareRequest().get(uriSq);
    res.status(sqResult.status).json(sqResult.data);
  } catch (err)
  {
    const errResult = sqPrepareError(err);
    res.status(errResult.code).json(errResult);
  }
});

app.post('/v2/locations/:locationId/orders', async (req, res) => {
  try {
    const uriSq = `/v2/locations/${req.params.locationId}/orders`;
    const sqResult = await sqPrepareRequest().post(uriSq, req.body);
    res.status(sqResult.status).json(sqResult.data);
  } catch (err)
  {
    const errResult = sqPrepareError(err);
    res.status(errResult.code).json(errResult);
  }
});

app.post('/v2/payments', async (req, res) => {
  try {
    const uriSq = `/v2/payments`;
    const sqResult = await sqPrepareRequest().post(uriSq, req.body);
    res.status(sqResult.status).json(sqResult.data);
  } catch (err)
  {
    const errResult = sqPrepareError(err);
    res.status(errResult.code).json(errResult);
  }
});

app.post('/v2/orders/calculate', async (req, res) => {
  try {
    const uriSq = `/v2/orders/calculate`;
    const sqResult = await sqPrepareRequest().post(uriSq, req.body);
    res.status(sqResult.status).json(sqResult.data);
  } catch (err)
  {
    const errResult = sqPrepareError(err);
    res.status(errResult.code).json(errResult);
  }
});

app.post('/v2/orders/:orderId/pay', async (req, res) => {
  try {
    const uriSq = `/v2/orders/${req.params.orderId}/pay`;
    const sqResult = await sqPrepareRequest().post(uriSq, req.body);
    res.status(sqResult.status).json(sqResult.data);
  } catch (err)
  {
    const errResult = sqPrepareError(err);
    res.status(errResult.code).json(errResult);
  }
});

app.post('/v2/payments/:paymentId/cancel', async (req, res) => {
  try {
    const uriSq = `/v2/payments/${req.params.paymentId}/cancel`;
    const sqResult = await sqPrepareRequest().post(uriSq, req.body);
    res.status(sqResult.status).json(sqResult.data);
  } catch (err)
  {
    const errResult = sqPrepareError(err);
    res.status(errResult.code).json(errResult);
  }
});

app.put('/v2/locations/:locationId/orders/:orderId', async (req, res) => {
  try {
    const uriSq = `/v2/locations/${req.params.locationId}/orders/${req.params.orderId}`;
    const sqResult = await sqPrepareRequest().put(uriSq, req.body);
    res.status(sqResult.status).json(sqResult.data);
  } catch (err)
  {
    const errResult = sqPrepareError(err);
    res.status(errResult.code).json(errResult);
  }
});

app.use(validateFirebaseIdToken);

app.get('/hello', async (req, res) => {
  // @ts-ignore
  let message = `Hello ${req.user.name}`;
  //await admin.firestore().collection('messages').add({original: message});
  const fbUser = (await admin.firestore().collection('users').doc(req.user.uid).get()).data();
  let fbUserName = '<undefined>';
  if (fbUser.username) {
    fbUserName = fbUser.username;
  }
  message = message + ', your FireBase username: ' + fbUserName;
  res.send(message);
});

app.use(function(req, res, next) {
  res.status(404).json({ code: 404, message: 'Not Found' });
});

exports.app = functions.https.onRequest(app);
