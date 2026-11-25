// Apply the saved/system theme before first paint to avoid a flash.
// A separate file (not inline) so the server's Content-Security-Policy can stay at script-src 'self'.
(function () {
  try {
    var t = null;
    try { t = localStorage.getItem('nacta-theme'); } catch (e) {}
    var dark = t === 'dark' || ((t === null || t === 'system') && window.matchMedia('(prefers-color-scheme: dark)').matches);
    if (dark) document.documentElement.classList.add('dark');
    document.documentElement.style.colorScheme = dark ? 'dark' : 'light';
  } catch (e) {}
})();
