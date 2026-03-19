# Bondforge

Standalone HTML chemical drawing app built with Vite + TypeScript.

## GitHub Pages

This project is configured to deploy the built `dist/` folder to GitHub Pages with GitHub Actions.

### 1. Push to GitHub

Create a GitHub repository and push this project to the `main` branch.

### 2. Enable Pages

In the GitHub repository:

1. Open `Settings`
2. Open `Pages`
3. Under `Build and deployment`, set `Source` to `GitHub Actions`

GitHub's custom Pages workflow docs:
- [Using custom workflows with GitHub Pages](https://docs.github.com/en/pages/getting-started-with-github-pages/using-custom-workflows-with-github-pages)
- [Configuring a publishing source for your GitHub Pages site](https://docs.github.com/en/pages/getting-started-with-github-pages/configuring-a-publishing-source-for-your-github-pages-site)

### 3. Wait for deploy

After you push to `main`, GitHub Actions will build and publish the app.

The final URL will be one of these:

- Project site: `https://USERNAME.github.io/REPOSITORY-NAME/`
- User site: `https://USERNAME.github.io/`

Because the Vite build uses relative asset paths, it works for either form.

### 4. Embed in Google Sites

In Google Sites:

1. Choose `Insert`
2. Choose `Embed`
3. Choose `By URL`
4. Paste the GitHub Pages URL

If Google Sites accepts the URL, it will render the editor in an embedded frame.

Example embed target:

```text
https://USERNAME.github.io/chemical-drawing/
```
