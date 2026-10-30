/** QuizRocket is a fully static site: all security lives in Supabase (RLS + database functions).
 *  `next build` writes plain HTML/JS to ./out, which any HTTPS static host can serve. */
const nextConfig = {
  output: 'export',
  trailingSlash: true,
  images: { unoptimized: true },
  eslint: { ignoreDuringBuilds: true },
  reactStrictMode: true,
};
export default nextConfig;
