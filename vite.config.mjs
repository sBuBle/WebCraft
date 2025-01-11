import { defineConfig } from 'vite';
import path from 'path';
import legacy from '@vitejs/plugin-legacy';

export default defineConfig({
	root: 'src',
	build: {
		outDir: '../public',
		emptyOutDir: true,
		rollupOptions: {
			input: {
				main: path.resolve(__dirname, 'src/index.html') // Ensure path is src/index.html
			},
			output: {
				manualChunks: undefined,
			},
		},
	},
	server: {
		port: 8080,
		strictPort: true,
	},
	plugins: [
		legacy({
			targets: ['defaults', 'not IE 11']
		}),
	]
});
