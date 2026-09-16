import { defineConfig, loadEnv } from 'vite';
import react from '@vitejs/plugin-react';
import path from 'path';
import { visualizer } from 'rollup-plugin-visualizer';
// https://vitejs.dev/config/
export default defineConfig(({ mode }) => {
    // Load env file based on `mode` in the current working directory.
    // This will load .env, .env.local, .env.[mode], .env.[mode].local
    // `process.cwd()` is used to point to the root of your frontend project.
    const env = loadEnv(mode, process.cwd(), '');
    return {
        plugins: [
            react(),
            // This plugin must be placed last.
            // It generates a visual report of your bundle composition.
            // To use, run: `VITE_VISUALIZE=true npm run build`
            env.VITE_VISUALIZE === 'true' &&
                visualizer({
                    open: false, // Keep the bundle report generation quiet unless explicitly opened
                    filename: 'dist/stats.html', // The output file for the report
                    gzipSize: true, // Show the gzipped size
                    brotliSize: true, // Show the brotli compressed size
                }),
        ],
        server: {
            host: '0.0.0.0',
            port: 5174,
            strictPort: true,
            open: false,
            proxy: {
                '/api': {
                    // Use an environment variable for the proxy target, with a fallback for local development.
                    // This makes it easy to point to a staging or different local backend.
                    target: env.VITE_API_PROXY_TARGET || 'http://localhost:5000',
                    changeOrigin: true,
                    // In production, this should be true. For local dev with self-signed certs, false is okay.
                    // Consider using an environment variable to control this.
                    secure: env.NODE_ENV !== 'production',
                    // Add this to debug proxy requests. It's now conditional.
                    // To enable, run `VITE_DEBUG_PROXY=true npm run dev`
                    ...(env.VITE_DEBUG_PROXY === 'true' && {
                        configure: (proxy) => {
                            proxy.on('error', (err, _req, _res) => {
                                console.log('proxy error', err);
                            });
                            proxy.on('proxyReq', (proxyReq, req, _res) => {
                                console.log('Sending Request to the Target:', req.method, req.url);
                            });
                            proxy.on('proxyRes', (proxyRes, req, _res) => {
                                console.log('Received Response from the Target:', proxyRes.statusCode, req.url);
                            });
                        },
                    }),
                },
            },
        },
        preview: {
            host: '0.0.0.0',
            port: 5000,
            strictPort: true,
        },
        build: {
            target: 'es2022',
            // Disable sourcemaps for production for better performance and security.
            // You can set this to 'hidden' if you want to upload sourcemaps to a monitoring service.
            sourcemap: false,
            cssCodeSplit: true,
            chunkSizeWarningLimit: 900, // Increase the warning limit to 900kb to reduce noise from large dependencies.
            // Enable terser for minification. It's the default but being explicit is good.
            minify: 'terser',
            // Terser types can be strict with the shape of options depending on @types/terser.
            // Cast to `any` to avoid type incompatibilities while keeping the intended
            // behavior (dropping console/debugger in production bundles).
            terserOptions: {
                compress: {
                    drop_console: true, // Remove console.log statements from production build
                    drop_debugger: true,
                },
            },
            rollupOptions: {
                onwarn(warning, warn) {
                    if (warning.code === 'COMMONJS_VARIABLE_IN_ESM') {
                        return;
                    }
                    warn(warning);
                },
                output: {
                    // Aggressive chunking: break vendor-core into separate loadable parts
                    manualChunks(id) {
                        if (!id.includes('node_modules'))
                            return;
                        // React core packages
                        if (id.includes('node_modules/react/') || id.includes('node_modules\\react\\'))
                            return 'vendor-react';
                        if (id.includes('node_modules/react-dom/') || id.includes('node_modules\\react-dom\\'))
                            return 'vendor-react-dom';
                        // Media players
                        if (id.includes('dashjs'))
                            return 'vendor-dash';
                        if (id.includes('hls.js') || id.includes('hls'))
                            return 'vendor-hls';
                        if (id.includes('react-player'))
                            return 'vendor-player';
                        // Heavy UI libraries
                        if (id.includes('recharts'))
                            return 'vendor-charts';
                        if (id.includes('lucide-react') || id.includes('lucide'))
                            return 'vendor-icons';
                        if (id.includes('framer-motion') || id.includes('framer'))
                            return 'vendor-animation';
                        if (id.includes('@radix-ui') || id.includes('radix-ui'))
                            return 'vendor-radix';
                        // State & routing  
                        if (id.includes('react-router') || id.includes('react-router-dom'))
                            return 'vendor-router';
                        if (id.includes('@reduxjs') || id.includes('react-redux') || id.includes('redux'))
                            return 'vendor-state';
                        // Data & tables
                        if (id.includes('@tanstack') || id.includes('tanstack'))
                            return 'vendor-data';
                        // Network & HTTP
                        if (id.includes('socket.io'))
                            return 'vendor-socket';
                        if (id.includes('axios'))
                            return 'vendor-http';
                        // Forms & validation
                        if (id.includes('react-hook-form') || id.includes('@hookform'))
                            return 'vendor-form';
                        if (id.includes('zod'))
                            return 'vendor-zod';
                        // Date/time utilities
                        if (id.includes('date-fns'))
                            return 'vendor-dates';
                        if (id.includes('react-day-picker') || id.includes('day-picker'))
                            return 'vendor-date-picker';
                        // Utilities & helpers
                        if (id.includes('lodash') || id.includes('lodash-es'))
                            return 'vendor-lodash';
                        if (id.includes('uuid'))
                            return 'vendor-uuid';
                        if (id.includes('qs'))
                            return 'vendor-qs';
                        if (id.includes('ky'))
                            return 'vendor-ky';
                        if (id.includes('ms'))
                            return 'vendor-ms';
                        // Services & backend communication
                        if (id.includes('@supabase'))
                            return 'vendor-supabase';
                        if (id.includes('@logtail'))
                            return 'vendor-logging';
                        // Notifications & UI feedback
                        if (id.includes('sonner'))
                            return 'vendor-toast';
                        if (id.includes('nprogress'))
                            return 'vendor-progress';
                        // Styling & CSS utilities
                        if (id.includes('@emotion'))
                            return 'vendor-emotion';
                        if (id.includes('clsx'))
                            return 'vendor-clsx';
                        if (id.includes('tailwind-merge'))
                            return 'vendor-tailwind-merge';
                        if (id.includes('class-variance'))
                            return 'vendor-cva';
                        // React utilities
                        if (id.includes('react-is'))
                            return 'vendor-react-is';
                        if (id.includes('use-sync-external-store'))
                            return 'vendor-sync-store';
                        if (id.includes('scheduler'))
                            return 'vendor-scheduler';
                        if (id.includes('@babel/runtime'))
                            return 'vendor-babel-runtime';
                        // Common React ecosystem utilities that can be heavy
                        if (id.includes('hoist-non-react-statics'))
                            return 'vendor-hoist';
                        if (id.includes('immer'))
                            return 'vendor-immer';
                        if (id.includes('reselect'))
                            return 'vendor-reselect';
                        if (id.includes('react-is'))
                            return 'vendor-react-is';
                        // Extract transitive dependencies that bundle with form/state libraries
                        if (id.includes('fast-equals'))
                            return 'vendor-fast-equals';
                        if (id.includes('memoize-one'))
                            return 'vendor-memoize';
                        if (id.includes('resolve-pathname'))
                            return 'vendor-resolve-pathname';
                        if (id.includes('value-equal'))
                            return 'vendor-value-equal';
                        if (id.includes('shallowequal'))
                            return 'vendor-shallowequal';
                        // UI & cropping utilities
                        if (id.includes('async-mutex'))
                            return 'vendor-async-mutex';
                        if (id.includes('react-easy-crop'))
                            return 'vendor-easy-crop';
                        // Leave small and page-specific dependencies to Rollup's graph-based chunking.
                        // Splitting every package creates excessive requests and duplicates shared edges.
                    },
                },
            },
        },
        resolve: {
            alias: [{ find: '@', replacement: path.resolve(import.meta.dirname, 'src') }],
            extensions: ['.mjs', '.ts', '.tsx', '.js', '.jsx', '.json'],
        },
    };
});
