// backup of pages/_document.js
// Moved because this project uses the App Router (app/). Keeping this file
// under pages/ can cause Next.js to import Html outside of pages/_document
// during certain prerender/export operations and fail builds on some hosts.

import Document, { Html, Head, Main, NextScript } from 'next/document'

class MyDocument extends Document {
  static async getInitialProps(ctx) {
    const initialProps = await Document.getInitialProps(ctx)
    return { ...initialProps }
  }

  render() {
    return (
      <Html lang="en">
        <Head />
        <body>
          <Main />
          <NextScript />
        </body>
      </Html>
    )
  }
}

export default MyDocument
