package com.example.recorder;

import java.io.FileReader;
import java.io.IOException;
import java.io.Reader;
import java.lang.reflect.Type;
import java.net.URL;
import java.nio.file.Files;
import java.nio.file.Path;
import java.nio.file.Paths;
import java.time.Duration;
import java.util.ArrayList;
import java.util.LinkedHashMap;
import java.util.List;
import java.util.Map;

import org.openqa.selenium.By;
import org.openqa.selenium.JavascriptExecutor;
import org.openqa.selenium.OutputType;
import org.openqa.selenium.TakesScreenshot;
import org.openqa.selenium.WebDriver;
import org.openqa.selenium.WebElement;
import org.openqa.selenium.chrome.ChromeDriver;
import org.openqa.selenium.chrome.ChromeOptions;
import org.openqa.selenium.remote.RemoteWebDriver;
import org.openqa.selenium.support.ui.ExpectedConditions;
import org.openqa.selenium.support.ui.WebDriverWait;

import com.google.gson.Gson;
import com.google.gson.GsonBuilder;
import com.google.gson.JsonElement;
import com.google.gson.JsonParser;
import com.google.gson.reflect.TypeToken;

/**
 * RecordingExecutor - improved, cleaned-up version.
 * Paste into runner/src/main/java/com/example/recorder/RecordingExecutor.java
 */
public class RecordingExecutor {

    static class Action {
        public String action;
        public String selector;
        public String url;
        public String value;
        public Integer timeout;
        public String path;
        public Map<String, Object> meta;
        public Long time;
    }

    WebDriver driver;

    // Execution log entries
    List<Map<String, Object>> executionLog = new ArrayList<>();

    void log(String event, Object detail) {
        try {
            Map<String, Object> entry = new LinkedHashMap<>();
            entry.put("time", System.currentTimeMillis());
            entry.put("event", event);
            entry.put("detail", detail);
            executionLog.add(entry);
            System.out.println("[log] " + event + " - " + (detail == null ? "" : detail.toString()));
        } catch (Exception ignored) {}
    }

    void startLocalChrome(boolean headless) {
        ChromeOptions opts = new ChromeOptions();
        if (headless) {
            opts.addArguments("--headless=new", "--disable-gpu", "--window-size=1920,1080");
        }
        opts.addArguments("--no-sandbox", "--disable-dev-shm-usage");
        // optionally you can add user-data-dir or remote-debugging-port if needed
        driver = new ChromeDriver(opts);
        log("driverStarted", "local chrome (headless=" + headless + ")");
    }

    void startRemote(String remoteUrl, String browserName, String browserVersion) throws Exception {
        // Use RemoteWebDriver (Selenium Grid / selenium server)
        com.google.common.collect.ImmutableMap.Builder<String, Object> b = com.google.common.collect.ImmutableMap.builder();
        if (browserName != null) b.put("browserName", browserName);
        if (browserVersion != null) b.put("browserVersion", browserVersion);
        driver = new RemoteWebDriver(new URL(remoteUrl), new org.openqa.selenium.remote.DesiredCapabilities());
        log("driverStarted", "remote " + remoteUrl + " browser=" + (browserName == null ? "chrome" : browserName));
    }

    void stop() {
        if (driver != null) {
            try {
                driver.quit();
                log("driverStopped", "");
            } catch (Exception e) {
                System.out.println("[warn] error stopping driver: " + e.toString());
            }
        }
    }

    By byFromSelector(String selector) {
        if (selector == null) return null;
        if (selector.startsWith("css=")) return By.cssSelector(selector.substring(4));
        if (selector.startsWith("xpath=")) return By.xpath(selector.substring(6));
        return By.cssSelector(selector);
    }

    /**
     * Robust clicking strategy:
     * - try elementToBeClickable (longer timeout)
     * - try fallback xpath (if given)
     * - try findElements + JS click
     * - last-resort generic button/submit XPath
     */
    public void smartClick(By by, Integer timeoutMs, String fallbackXpath) {
        Duration waitDur = (timeoutMs == null ? Duration.ofSeconds(25) : Duration.ofMillis(timeoutMs));
        WebDriverWait wait = new WebDriverWait(driver, waitDur);

        // 1) clickable element
        try {
            WebElement el = wait.until(ExpectedConditions.elementToBeClickable(by));
            try { ((JavascriptExecutor) driver).executeScript("arguments[0].scrollIntoView({block:'center'});", el); } catch (Exception ignored) {}
            el.click();
            log("click", by.toString());
            return;
        } catch (Exception e) {
            System.out.println("Primary click failed for " + by + ". Trying fallback...");
        }

        // 2) fallback xpath
        if (fallbackXpath != null) {
            try {
                WebElement el = wait.until(ExpectedConditions.elementToBeClickable(By.xpath(fallbackXpath)));
                try { ((JavascriptExecutor) driver).executeScript("arguments[0].scrollIntoView({block:'center'});", el); } catch (Exception ignored) {}
                el.click();
                log("click_fallback_xpath", fallbackXpath);
                System.out.println("Fallback XPath worked: " + fallbackXpath);
                return;
            } catch (Exception e) {
                System.out.println("Fallback XPath did not work: " + fallbackXpath);
            }
        }

        // 3) findElements + JS click
        try {
            List<WebElement> list = driver.findElements(by);
            if (list != null && !list.isEmpty()) {
                WebElement el = list.get(0);
                try {
                    ((JavascriptExecutor) driver).executeScript("arguments[0].scrollIntoView(true); arguments[0].click();", el);
                    log("click_js", by.toString());
                    System.out.println("JS click worked for: " + by);
                    return;
                } catch (Exception jsEx) {
                    System.out.println("JS click failed for " + by + ": " + jsEx.toString());
                }
            } else {
                System.out.println("No elements found for " + by + " when trying JS click.");
            }
        } catch (Exception e) {
            System.out.println("Error during findElements/js click: " + e.toString());
        }

        // 4) generic submit/button fallback
        try {
            By anyBtn = By.xpath("//*[contains(@id,'acceptTerms') or contains(@name,'acceptTerms') or contains(@id,'submit') or contains(@id,'proceed') or contains(@id,'login') or contains(@class,'btn')]");
            WebElement el = new WebDriverWait(driver, waitDur).until(ExpectedConditions.elementToBeClickable(anyBtn));
            ((JavascriptExecutor) driver).executeScript("arguments[0].scrollIntoView(true); arguments[0].click();", el);
            log("click_generic_fallback", anyBtn.toString());
            System.out.println("Generic fallback click worked");
            return;
        } catch (Exception e) {
            throw new RuntimeException("All click strategies failed for: " + by, e);
        }
    }

    void runActions(List<Action> actions) throws Exception {
        for (int i = 0; i < actions.size(); i++) {
            Action a = actions.get(i);
            log("action_start", a.action + " " + (a.selector == null ? "" : a.selector) + " " + (a.value == null ? "" : a.value));
            System.out.println(">>> " + a.action + " " + (a.selector != null ? a.selector : "") + " " + (a.value != null ? a.value : ""));

            if (("click".equalsIgnoreCase(a.action) || "type".equalsIgnoreCase(a.action))) {
                try {
                    String current = "";
                    try { current = driver.getCurrentUrl(); } catch (Exception ignored) {}
                    if (current == null || current.isEmpty() || current.startsWith("data:") || current.startsWith("about:blank")) {
                        String navUrl = null;
                        for (int j = i - 1; j >= 0; j--) {
                            Action prev = actions.get(j);
                            if ("navigate".equalsIgnoreCase(prev.action) && prev.url != null && !prev.url.isEmpty()) {
                                navUrl = prev.url;
                                break;
                            }
                        }
                        if (navUrl != null) {
                            log("recover_navigate", navUrl);
                            System.out.println("[recover] current tab blank — navigating to last recorded URL: " + navUrl);
                            driver.get(navUrl);
                            waitForDocumentReady();
                            waitForPageStable(800);
                        } else {
                            System.out.println("[recover] no previous navigate found in recording. Click/type may fail.");
                        }
                    }
                } catch (Exception e) {
                    System.out.println("[recover] error while trying to recover blank page: " + e.toString());
                }
            }

            switch (a.action) {
                case "navigate":
                    log("navigate", a.url);
                    driver.get(a.url);
                    waitForDocumentReady();
                    waitForPageStable(3000);
                    break;

                case "click": {
                    By by = byFromSelector(a.selector);
                    String fallback = null;
                    if (a.selector != null && (a.selector.contains("acceptTerms") || a.selector.contains("submit") || a.selector.contains("proceed") || a.selector.contains("login"))) {
                        fallback = "//*[contains(@id,'acceptTerms') or contains(@name,'acceptTerms') or contains(@id,'submit') or contains(@id,'proceed') or contains(@id,'login') or contains(@class,'btn')]";
                    }
                    smartClick(by, a.timeout, fallback);
                    break;
                }

                case "type": {
                    By by = byFromSelector(a.selector);
                    waitUntilVisible(by, a.timeout);
                    WebElement e = driver.findElement(by);
                    try { e.clear(); } catch (Exception ignored) {}
                    long delay = 0;
                    try { delay = Long.parseLong(System.getProperty("typingDelay", "0")); } catch (Exception ignored) {}
                    String txt = a.value == null ? "" : a.value;
                    if (delay == 0) {
                        e.sendKeys(txt);
                        log("type", a.selector + " => " + txt);
                    } else {
                        StringBuilder built = new StringBuilder();
                        for (char c : txt.toCharArray()) {
                            e.sendKeys(String.valueOf(c));
                            built.append(c);
                            try { Thread.sleep(delay); } catch (InterruptedException ignored) {}
                        }
                        log("type_slow", a.selector + " => " + built.toString());
                    }
                    break;
                }

                case "wait": {
                    By by = byFromSelector(a.selector);
                    waitUntilVisible(by, a.timeout);
                    log("wait", a.selector);
                    break;
                }

                case "screenshot":
                    takeScreenshot(a.path);
                    log("screenshot", a.path);
                    break;

                case "assertText": {
                    By by = byFromSelector(a.selector);
                    waitUntilVisible(by, a.timeout);
                    String text = driver.findElement(by).getText();
                    log("assertText", a.selector + " -> " + text);
                    if (!text.contains(a.value)) throw new AssertionError("assertText failed. Expected to contain: " + a.value + " but was: " + text);
                    break;
                }

                default:
                    System.out.println("Unknown action: " + a.action);
                    log("unknown_action", a.action);
            }

            log("action_end", a.action);
        }
    }

    void waitUntilVisible(By by, Integer timeoutMs) {
        Duration t = (timeoutMs == null ? Duration.ofSeconds(12) : Duration.ofMillis(timeoutMs));
        new WebDriverWait(driver, t).until(ExpectedConditions.visibilityOfElementLocated(by));
    }

    void takeScreenshot(String path) throws IOException {
        if (path == null) path = "out/screen-" + System.currentTimeMillis() + ".png";
        Path p = Paths.get(path);
        if (p.getParent() != null) Files.createDirectories(p.getParent());
        byte[] bytes = ((TakesScreenshot) driver).getScreenshotAs(OutputType.BYTES);
        Files.write(p, bytes);
        System.out.println("Saved screenshot to " + path);
    }

    // ----- stability helpers -----
    void waitForDocumentReady() {
        try {
            WebDriverWait w = new WebDriverWait(driver, Duration.ofSeconds(20));
            w.until(d -> {
                try {
                    Object state = ((JavascriptExecutor) d).executeScript("return document.readyState");
                    return state != null && "complete".equals(state.toString());
                } catch (Exception ex) {
                    return false;
                }
            });
        } catch (Exception ignored) {
            System.out.println("[warn] document.readyState wait skipped or timed out");
        }
    }

    void waitForPageStable(long ms) {
        try { Thread.sleep(ms); } catch (Exception ignored) {}
    }

    private void saveExecutionLogSafe() {
    try {
        String logDirProp = System.getProperty("logDir", "out");
        Path outDir = Paths.get(logDirProp);
        if (!Files.exists(outDir)) Files.createDirectories(outDir);
        String logPath = logDirProp + "/log-" + System.currentTimeMillis() + ".json";
        Gson pretty = new GsonBuilder().setPrettyPrinting().create();
        Files.write(Paths.get(logPath), pretty.toJson(executionLog).getBytes());
        System.out.println("[runner] log saved to " + logPath);
    } catch (Exception e) {
        System.out.println("[runner] failed to save execution log: " + e.toString());
    }
}


    public static void main(String[] args) throws Exception {
        System.out.println("RecordingExecutor v1.0");
        if (args.length == 0) {
            System.out.println("Usage: java -jar record-and-runner.jar recordings/sample-recording.json [local|remote] [headless:true|false]");
            return;
        }
        String file = args[0];
        String mode = args.length > 1 ? args[1] : "local";
        boolean headless = args.length > 2 ? Boolean.parseBoolean(args[2]) : false; // default visible

        Gson gson = new Gson();
        Type listType = new TypeToken<List<Action>>() {}.getType();
        List<Action> actions = null;
        String startUrl = null;
        JsonElement root = null;

        try (Reader r = new FileReader(file)) {
            root = JsonParser.parseReader(r);
            if (root.isJsonArray()) {
                actions = gson.fromJson(root, listType);
            } else if (root.isJsonObject() && root.getAsJsonObject().has("actions")) {
                actions = gson.fromJson(root.getAsJsonObject().get("actions"), listType);
                if (root.getAsJsonObject().has("startUrl")) {
                    startUrl = root.getAsJsonObject().get("startUrl").getAsString();
                }
            } else {
                throw new IllegalStateException("Invalid recording format. Expected JSON array or {\"actions\": [...] }");
            }
        } catch (Exception e) {
            System.out.println("[error] Failed to read recording file: " + e.toString());
            throw e;
        }

        // ensure first action is navigate
if (actions.size() == 0 || !"navigate".equalsIgnoreCase(actions.get(0).action)) {
    String defaultUrl = System.getProperty("defaultUrl", null);
    String toUse = startUrl != null ? startUrl : (defaultUrl != null ? defaultUrl : null);

    if (toUse == null) {
        // No start URL provided anywhere — fail fast with clear message and do not auto-insert about:blank
        System.out.println("[error] Recording has no initial navigate and no startUrl/defaultUrl supplied. " +
                "Set -DdefaultUrl=https://your.start.url or add a 'navigate' action or 'startUrl' to the recording JSON.");
        throw new IllegalStateException("Missing start URL for recording. Provide -DdefaultUrl or add startUrl in recording.");
    }

    Action nav = new Action();
    nav.action = "navigate";
    nav.url = toUse;
    nav.time = System.currentTimeMillis();
    actions.add(0, nav);
    System.out.println("[runner] Auto-inserted navigate to: " + toUse);
}


        RecordingExecutor exec = new RecordingExecutor();
        try {
            if ("remote".equalsIgnoreCase(mode)) {
                String remoteUrl = System.getProperty("remoteUrl");
                String browser = System.getProperty("browser");
                String browserVersion = System.getProperty("browserVersion");
                if (remoteUrl == null) {
                    System.out.println("Remote mode requested but -DremoteUrl is missing. Example: -DremoteUrl=https://hub-cloud.browserstack.com/wd/hub");
                    return;
                }
                exec.startRemote(remoteUrl, browser, browserVersion);
            } else {
                exec.startLocalChrome(headless);
            }

            exec.log("run_start", file + " mode=" + mode + " headless=" + headless);
            exec.runActions(actions);
            exec.log("run_finished", "success");
            System.out.println("Run finished successfully.");
            exec.saveExecutionLogSafe();

        } catch (Throwable t) {
            System.out.println("[runner] Exception during run: " + t.toString());
            exec.log("run_error", t.toString());
            exec.saveExecutionLogSafe();
            throw t instanceof Exception ? (Exception) t : new Exception(t);
        } finally {
            exec.stop();
        }
    }
}
