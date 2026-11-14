# IVMS 3.0 - AWS Amplify Hosting

This is a static HTML5/CSS/JavaScript dashboard. The root `index.html` is the application entry point.

## Deploy using AWS Amplify Hosting

1. Sign in to the AWS Console and open **AWS Amplify**.
2. Choose **Deploy an app** > **GitHub** and authorize the repository `PeteT11/IVMS-3.0-Web`.
3. Select branch `main`.
4. Review the automatically detected build settings. Amplify should use the repository's `amplify.yml` file.
5. Confirm the build command copies `index.html` into `dist/`, and the output directory is `dist`.
6. Choose **Save and deploy**.
7. Open the default `*.amplifyapp.com` URL after the deployment succeeds.
8. In Amplify, optionally choose **Domain management** to connect a custom domain.

## Google Maps

The HTML currently contains `YOUR_GOOGLE_MAPS_API_KEY`. Before a working Google Map can display:
- Enable **Maps JavaScript API** in Google Cloud and configure billing as required.
- Create a browser API key restricted to the website's HTTPS origin (Amplify domain and any custom domain).
- Restrict the key to the necessary Google Maps APIs.
- Replace `YOUR_GOOGLE_MAPS_API_KEY` in `index.html` and commit the change.

A browser Maps key is visible to site visitors; restrictions are essential. Do not place IVMS API secrets, service tokens, or private credentials in frontend HTML, GitHub, or client-visible environment variables.

## IVMS REST API

The dashboard is currently a frontend prototype; the IVMS API is not connected. For browser-side calls, the API must support HTTPS, appropriate CORS origins, and secure user authentication. Use a backend proxy or backend-for-frontend for confidential service credentials.

## Operations

- Commits to `main` trigger Amplify deployments once the GitHub connection is configured.
- Check Amplify build logs for deployment errors.
- Set up AWS Budgets and optional custom-domain DNS/SSL management.
- Test the deployed dashboard on desktop and mobile.

## Build specification

`amplify.yml` copies the static website to `dist/`; Amplify publishes that directory. No npm install is required.
