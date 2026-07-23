export default {
  entry: './src/index.jsx',
  target: false,
  devtool: false,
  output: {
    filename: 'index.cjs',
    chunkFormat: 'commonjs',
    library: {
      type: 'commonjs',
    },
  },
  module: {
    rules: [
      // Loaders go here.

      // NOTE: Remove this block and the following dependencies if you do not need React and JSX
      // @babel/core, babel-loader, @babel/preset-react, react, react-dom
      {
        test: /\.jsx?$/,
        exclude: /node_modules/,
        use: {
          loader: 'babel-loader',
          options: {
            presets: [
              [
                '@babel/preset-react',
                {
                  runtime: 'automatic',
                },
              ],
            ],
          }
        },
      },

    ],
  },
  resolve: {
    extensions: [],
    conditionNames: [
      'fastly',
      '...',
    ],
  },
  plugins: [
    // Webpack Plugins and Polyfills go here
    // e.g., cross-platform WHATWG or core Node.js modules needed for your application.
    // new webpack.ProvidePlugin({
    // }),
  ],
  externals: [
    // Allow webpack to handle 'fastly:*' namespaced module imports by treating
    // them as modules rather than trying to process them as URLs
    /^fastly:.*$/,
  ],
};
