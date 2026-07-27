/** @type {import('next').NextConfig} */
const nextConfig = {
  reactStrictMode: true,
  transpilePackages: ['@criticom/api', '@criticom/db', '@criticom/ui'],
  experimental: {
    // React 19 RC type compatibility
    typedRoutes: false,
  },
  images: {
    remotePatterns: [
      { protocol: 'https', hostname: '*.supabase.co' },
      { protocol: 'https', hostname: '*.supabase.in' },
    ],
  },
};
export default nextConfig;
