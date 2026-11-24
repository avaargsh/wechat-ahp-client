'use strict';

// The build CLI imports download-git-repo at startup even when initializing
// a new project is out of scope. This intentionally exposes the expected
// CommonJS function but never shells out, downloads, or clones repositories.
module.exports = function remoteTemplateDownloadDisabled() {
  const error = new Error('Taro remote template download is disabled in this workspace');
  error.code = 'ERR_TARO_REMOTE_TEMPLATE_DISABLED';
  throw error;
};
