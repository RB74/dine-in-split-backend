# Dine-In Split Back End

## Env file
In `functions` directory, prepare `.env` file, see https://github.com/square/connect-api-examples/tree/master/connect-examples/oauth/node#step-2-get-your-credentials-and-set-the-redirect-url .

## Installing dependencies
Install dependencies locally by running: `cd functions; npm install; cd -`

## Run Square Sandbox
https://github.com/square/connect-api-examples/tree/master/connect-examples/oauth/node#step-3-running-the-example (1-2 points)

## Deploy and test

This sample comes with a web-based UI for testing the function.
To test locally do:

 1. Start serving your project locally using `firebase serve --only hosting,functions`
 1. Open the app in a browser at `http://localhost:5000`.

To deploy and test on prod do:

 1. Deploy your functions using `firebase deploy`
 1. Open the app using `firebase open hosting:site`, this will open a browser.

## App Prod link
https://dineinsplit.web.app/


