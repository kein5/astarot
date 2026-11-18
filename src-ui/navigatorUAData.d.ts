// User-Agent Client Hints (navigator.userAgentData), which TypeScript's DOM types do not
// have yet. WebView2 (Chromium) has them; WebKitGTK does not, so the property is optional.
// Only what the app reads is declared (CornerRadiusController).
interface NavigatorUAData {
    getHighEntropyValues(hints: string[]): Promise<{ platformVersion?: string }>;
}

interface Navigator {
    readonly userAgentData?: NavigatorUAData;
}
