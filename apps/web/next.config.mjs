/** @type {import('next').NextConfig} */
const nextConfig = {
  reactStrictMode: true,
  transpilePackages: ['@criticom/api', '@criticom/db', '@criticom/ui'],
  // Moved out of `experimental` in Next 15.5
  typedRoutes: false,
  images: {
    remotePatterns: [
      { protocol: 'https', hostname: '*.supabase.co' },
      { protocol: 'https', hostname: '*.supabase.in' },
    ],
  },
};
export default nextConfig;
