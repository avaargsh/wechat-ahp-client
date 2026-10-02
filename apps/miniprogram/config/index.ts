import { defineConfig } from '@tarojs/cli';

export default defineConfig({
  projectName: 'wechat-ahp-client',
  date: '2026-10-02',
  designWidth: 390,
  deviceRatio: {
    390: 2,
    750: 1
  },
  sourceRoot: 'src',
  outputRoot: 'dist',
  framework: 'react',
  compiler: 'webpack5',
  mini: {}
});
