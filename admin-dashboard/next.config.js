/** @type {import('next').NextConfig} */
const nextConfig = {
  // Keep Next's file tracing scoped to this independently deployed dashboard.
  outputFileTracingRoot: __dirname,
};

module.exports = nextConfig;
