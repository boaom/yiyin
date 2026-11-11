package com.yiyin.app;

import android.annotation.SuppressLint;
import android.app.Activity;
import android.content.ContentResolver;
import android.content.ContentValues;
import android.content.Intent;
import android.content.pm.PackageManager;
import android.graphics.Color;
import android.net.Uri;
import android.os.Build;
import android.os.Bundle;
import android.os.Environment;
import android.provider.MediaStore;
import android.util.Base64;
import android.view.View;
import android.view.Window;
import android.view.WindowManager;
import android.webkit.JavascriptInterface;
import android.webkit.ValueCallback;
import android.webkit.WebChromeClient;
import android.webkit.WebResourceRequest;
import android.webkit.WebResourceResponse;
import android.webkit.WebSettings;
import android.webkit.WebView;
import android.webkit.WebViewClient;
import android.widget.Toast;

import org.json.JSONObject;

import java.io.ByteArrayInputStream;
import java.io.File;
import java.io.FileOutputStream;
import java.io.IOException;
import java.io.InputStream;
import java.io.OutputStream;
import java.nio.charset.StandardCharsets;
import java.util.HashMap;
import java.util.Map;

public class MainActivity extends Activity {

    private static final String ASSET_HOST = "appassets.yiyin.local";
    private static final String HOME_URL = "https://" + ASSET_HOST + "/index.html";
    private static final int REQ_FILE = 1001;
    private static final int REQ_STORAGE = 1002;

    private WebView webView;
    private ValueCallback<Uri[]> fileCallback;

    private final StringBuilder b64 = new StringBuilder();
    private String pendingName = "yiyin.jpg";
    private String pendingMode = "gallery";

    @SuppressLint("SetJavaScriptEnabled")
    @Override
    protected void onCreate(Bundle savedInstanceState) {
        super.onCreate(savedInstanceState);

        Window w = getWindow();
        w.setStatusBarColor(Color.parseColor("#0b0c0e"));
        w.setNavigationBarColor(Color.parseColor("#0b0c0e"));
        if (Build.VERSION.SDK_INT >= 23) {
            w.getDecorView().setSystemUiVisibility(0); // 深色主题：白色状态栏图标
        }

        webView = new WebView(this);
        webView.setBackgroundColor(Color.parseColor("#0b0c0e"));
        webView.setOverScrollMode(View.OVER_SCROLL_NEVER);
        setContentView(webView);

        WebSettings s = webView.getSettings();
        s.setJavaScriptEnabled(true);
        s.setDomStorageEnabled(true);
        s.setDatabaseEnabled(true);
        s.setAllowFileAccess(false);
        s.setAllowContentAccess(true);
        s.setSupportZoom(false);
        s.setBuiltInZoomControls(false);
        s.setLoadWithOverviewMode(false);
        s.setUseWideViewPort(false);
        s.setMediaPlaybackRequiresUserGesture(true);
        s.setCacheMode(WebSettings.LOAD_NO_CACHE);
        if (Build.VERSION.SDK_INT >= 26) s.setSafeBrowsingEnabled(false);

        webView.addJavascriptInterface(new Bridge(), "YiyinAndroid");

        webView.setWebViewClient(new WebViewClient() {
            @Override
            public WebResourceResponse shouldInterceptRequest(WebView view, WebResourceRequest request) {
                Uri uri = request.getUrl();
                if (uri == null || !ASSET_HOST.equals(uri.getHost())) return null;
                String path = uri.getPath();
                if (path == null || path.isEmpty() || "/".equals(path)) path = "/index.html";
                try {
                    String decoded = Uri.decode(path);
                    InputStream is = getAssets().open("www" + decoded);
                    Map<String, String> headers = new HashMap<>();
                    headers.put("Cache-Control", "no-cache");
                    return new WebResourceResponse(mimeOf(decoded), null, 200, "OK", headers, is);
                } catch (IOException e) {
                    return new WebResourceResponse("text/plain", "utf-8", 404, "Not Found",
                            new HashMap<String, String>(), new ByteArrayInputStream("404".getBytes(StandardCharsets.UTF_8)));
                }
            }
        });

        webView.setWebChromeClient(new WebChromeClient() {
            @Override
            public boolean onShowFileChooser(WebView view, ValueCallback<Uri[]> callback, FileChooserParams params) {
                if (fileCallback != null) fileCallback.onReceiveValue(null);
                fileCallback = callback;

                Intent intent = null;
                try {
                    intent = params.createIntent();
                } catch (Exception ignored) {
                }
                if (intent == null) {
                    intent = new Intent(Intent.ACTION_GET_CONTENT);
                    intent.addCategory(Intent.CATEGORY_OPENABLE);
                    intent.setType("*/*");
                }
                if (params.getMode() == FileChooserParams.MODE_OPEN_MULTIPLE) {
                    intent.putExtra(Intent.EXTRA_ALLOW_MULTIPLE, true);
                }
                try {
                    startActivityForResult(Intent.createChooser(intent, "选择文件"), REQ_FILE);
                } catch (Exception e) {
                    Toast.makeText(MainActivity.this, "没有可用的文件选择器", Toast.LENGTH_SHORT).show();
                    fileCallback = null;
                    return false;
                }
                return true;
            }
        });

        webView.loadUrl(HOME_URL);
    }

    private static String mimeOf(String path) {
        String p = path.toLowerCase();
        if (p.endsWith(".html") || p.endsWith(".htm")) return "text/html";
        if (p.endsWith(".js") || p.endsWith(".mjs")) return "application/javascript";
        if (p.endsWith(".css")) return "text/css";
        if (p.endsWith(".json")) return "application/json";
        if (p.endsWith(".svg")) return "image/svg+xml";
        if (p.endsWith(".png")) return "image/png";
        if (p.endsWith(".jpg") || p.endsWith(".jpeg")) return "image/jpeg";
        if (p.endsWith(".webp")) return "image/webp";
        if (p.endsWith(".ttf")) return "font/ttf";
        if (p.endsWith(".otf")) return "font/otf";
        if (p.endsWith(".woff")) return "font/woff";
        if (p.endsWith(".woff2")) return "font/woff2";
        return "application/octet-stream";
    }

    @Override
    protected void onActivityResult(int requestCode, int resultCode, Intent data) {
        if (requestCode == REQ_FILE) {
            if (fileCallback == null) return;
            Uri[] results = null;
            if (resultCode == RESULT_OK && data != null) {
                if (data.getClipData() != null) {
                    int n = data.getClipData().getItemCount();
                    results = new Uri[n];
                    for (int i = 0; i < n; i++) results[i] = data.getClipData().getItemAt(i).getUri();
                } else if (data.getData() != null) {
                    results = new Uri[]{data.getData()};
                }
            }
            fileCallback.onReceiveValue(results);
            fileCallback = null;
            return;
        }
        if (requestCode == REQ_STORAGE) {
            if (resultCode == RESULT_OK) commitWrite();
            else {
                toast("没有存储权限，无法保存");
                pendingMode = null;
            }
            return;
        }
        super.onActivityResult(requestCode, resultCode, data);
    }

    @Override
    public void onBackPressed() {
        webView.evaluateJavascript("(function(){try{return window.__yiyinBack&&window.__yiyinBack()?'1':'0'}catch(e){return '0'}})()", value -> {
            boolean handled = value != null && value.contains("1");
            if (!handled) finish();
        });
    }

    @Override
    protected void onDestroy() {
        if (webView != null) {
            webView.removeJavascriptInterface("YiyinAndroid");
            webView.destroy();
        }
        super.onDestroy();
    }

    private void toast(String msg) {
        runOnUiThread(() -> Toast.makeText(MainActivity.this, msg, Toast.LENGTH_SHORT).show());
    }

    private boolean needLegacyStorage() {
        return Build.VERSION.SDK_INT < 29
                && checkSelfPermission(android.Manifest.permission.WRITE_EXTERNAL_STORAGE) != PackageManager.PERMISSION_GRANTED;
    }

    private void commitWrite() {
        String mode = pendingMode;
        String name = pendingName;
        pendingMode = null;
        if (mode == null) return;

        byte[] bytes;
        try {
            bytes = Base64.decode(b64.toString(), Base64.DEFAULT);
        } catch (IllegalArgumentException e) {
            fail("数据解码失败");
            return;
        }
        b64.setLength(0);

        try {
            ContentResolver cr = getContentResolver();
            ContentValues values = new ContentValues();
            values.put(MediaStore.Images.Media.DISPLAY_NAME, name);
            values.put(MediaStore.Images.Media.MIME_TYPE, "image/jpeg");
            Uri uri;
            OutputStream os;

            if (Build.VERSION.SDK_INT >= 29) {
                values.put(MediaStore.Images.Media.RELATIVE_PATH, "Pictures/壹印");
                values.put(MediaStore.Images.Media.IS_PENDING, 1);
                uri = cr.insert(MediaStore.Images.Media.EXTERNAL_CONTENT_URI, values);
                if (uri == null) throw new IOException("MediaStore 插入失败");
                os = cr.openOutputStream(uri);
                if (os == null) throw new IOException("无法写入相册");
                os.write(bytes);
                os.flush();
                os.close();
                ContentValues done = new ContentValues();
                done.put(MediaStore.Images.Media.IS_PENDING, 0);
                cr.update(uri, done, null, null);
            } else {
                File dir = new File(Environment.getExternalStoragePublicDirectory(Environment.DIRECTORY_PICTURES), "壹印");
                if (!dir.exists() && !dir.mkdirs()) throw new IOException("无法创建目录");
                File out = new File(dir, name);
                FileOutputStream fos = new FileOutputStream(out);
                fos.write(bytes);
                fos.flush();
                fos.close();
                ContentValues scan = new ContentValues();
                scan.put(MediaStore.Images.Media.DATA, out.getAbsolutePath());
                scan.put(MediaStore.Images.Media.MIME_TYPE, "image/jpeg");
                scan.put(MediaStore.Images.Media.DISPLAY_NAME, name);
                uri = cr.insert(MediaStore.Images.Media.EXTERNAL_CONTENT_URI, scan);
                if (uri == null) uri = Uri.fromFile(out);
            }

            if ("share".equals(mode)) {
                Intent send = new Intent(Intent.ACTION_SEND);
                send.setType("image/jpeg");
                send.putExtra(Intent.EXTRA_STREAM, uri);
                send.addFlags(Intent.FLAG_GRANT_READ_URI_PERMISSION);
                Intent chooser = Intent.createChooser(send, "分享印框");
                chooser.addFlags(Intent.FLAG_ACTIVITY_NEW_TASK);
                startActivity(chooser);
            }

            JSONObject res = new JSONObject();
            res.put("ok", true);
            res.put("path", name);
            synchronized (this) { lastResult = res.toString(); }
        } catch (Exception e) {
            fail(e.getMessage() == null ? "保存失败" : e.getMessage());
        }
    }

    private String lastResult = "{}";

    private void fail(String msg) {
        try {
            JSONObject res = new JSONObject();
            res.put("ok", false);
            res.put("error", msg == null ? "保存失败" : msg);
            synchronized (this) { lastResult = res.toString(); }
        } catch (Exception ignored) {
        }
    }

    public class Bridge {
        @JavascriptInterface
        public void beginWrite(String name, String mode) {
            synchronized (MainActivity.this) {
                b64.setLength(0);
                pendingName = (name == null || name.isEmpty()) ? "yiyin.jpg" : name;
                pendingMode = (mode == null || mode.isEmpty()) ? "gallery" : mode;
                lastResult = "{}";
            }
        }

        @JavascriptInterface
        public void writeChunk(String chunk) {
            if (chunk != null) b64.append(chunk);
        }

        @JavascriptInterface
        public String endWrite() {
            if (needLegacyStorage()) {
                runOnUiThread(() -> requestPermissions(new String[]{android.Manifest.permission.WRITE_EXTERNAL_STORAGE}, REQ_STORAGE));
                try {
                    JSONObject res = new JSONObject();
                    res.put("ok", false);
                    res.put("error", "需要存储权限，请授权后再点保存");
                    return res.toString();
                } catch (Exception e) {
                    return "{\"ok\":false}";
                }
            }
            commitWrite();
            synchronized (MainActivity.this) {
                return lastResult;
            }
        }

        @JavascriptInterface
        public void toastMsg(String msg) {
            toast(msg);
        }

        @JavascriptInterface
        public String version() {
            return "1.0.0";
        }
    }
}