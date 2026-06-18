(function() {
  window.addEventListener('error', function(e) {
    var isChunkError = e.message && (
      e.message.indexOf('ChunkLoadError') !== -1 ||
      e.message.indexOf('Loading chunk') !== -1 ||
      e.message.indexOf('Failed to load chunk') !== -1
    );
    var isScriptFailure = e.target && 
      e.target.tagName === 'SCRIPT' && 
      e.target.src && 
      e.target.src.indexOf('/_next/static/') !== -1;

    if (isChunkError || isScriptFailure) {
      var now = Date.now();
      var lastReload = sessionStorage.getItem('last_chunk_reload');
      if (!lastReload || (now - parseInt(lastReload, 10)) > 10000) {
        sessionStorage.setItem('last_chunk_reload', now.toString());
        window.location.reload();
      }
    }
  }, true);
})();
