# ZETA Tools Gecko Preview 0.2.0

Independent ARM64 Android login-compatibility test using GeckoView. This is not the official ZETA app.
- Uses the actual ZETA website and default Gecko browser identity, with a separate persistent browser profile.
- OAuth windows remain in the same Gecko runtime in separate sessions; actual external origins are shown.
- No credential capture, cookie copying, authentication spoofing or remote script loading.
- Theme bundled from the public script, initially disabled. Test Google login first, then enable theme in ⋮.
- Fullscreen and keep-awake settings. Other tools and automatic script/APK updating are deferred until login is verified.
- Debug APK only; distinct application ID from WebView preview, no stable release signing yet.
- No guarantee Google permits this client. Verify Google login and reopening the app on real hardware.
- Mozilla GeckoView MPL notices and dependency licenses must be provided before public release.

Download the successful Actions artifact ZIP and extract app-debug.apk.
