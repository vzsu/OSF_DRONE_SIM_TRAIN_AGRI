/** @type {import('next').NextConfig} */
const nextConfig = {
  // the sim boots once from a client effect; StrictMode's double-mount would start two render loops
  reactStrictMode: false,
  poweredByHeader: false,
};

export default nextConfig;
