/** @type {import('next').NextConfig} */
const nextConfig = {
  reactStrictMode: true,
  experimental: {
    appDir: true
  },
  // Increase body parser size for uploads if necessary (Render sets Docker memory)
  api: {
    bodyParser: false
  }
};

export default nextConfig;
