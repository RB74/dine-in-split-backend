'use strict';

const functions = require('firebase-functions');
const admin = require('firebase-admin');
admin.initializeApp();
const express = require('express');
const cookieParser = require('cookie-parser')();
const cors = require('cors')({origin: true});
const app = express();

app.use(cors);
app.use(cookieParser);
app.get('/hello', (req, res) => {
  // @ts-ignore
  res.send(`Howdy Visitor!`);
});

exports.app = functions.https.onRequest(app);
