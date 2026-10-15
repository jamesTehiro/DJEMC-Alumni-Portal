import assert from "node:assert/strict";
import test from "node:test";
import { attachPortalDrawerEffects } from "../src/hooks/usePortalDrawer.js";

class FakeStyle {
    properties = new Map();

    setProperty(name, value, priority = "") {
        this.properties.set(name, { value, priority });
    }

    getPropertyValue(name) {
        return this.properties.get(name)?.value || "";
    }

    getPropertyPriority(name) {
        return this.properties.get(name)?.priority || "";
    }

    removeProperty(name) {
        this.properties.delete(name);
    }
}

class FakeEventTarget {
    listeners = new Map();

    addEventListener(type, listener) {
        if (!this.listeners.has(type)) this.listeners.set(type, new Set());
        this.listeners.get(type).add(listener);
    }

    removeEventListener(type, listener) {
        this.listeners.get(type)?.delete(listener);
    }

    dispatch(type, event) {
        for (const listener of this.listeners.get(type) || []) listener(event);
    }

    listenerCount(type) {
        return this.listeners.get(type)?.size || 0;
    }
}

function createDrawerEnvironment({ mobile = true, scrollbarWidth = 0, computedPadding = "0px" } = {}) {
    const media = new FakeEventTarget();
    media.matches = mobile;
    const drawerDocument = new FakeEventTarget();
    drawerDocument.body = { style: new FakeStyle() };
    drawerDocument.documentElement = { clientWidth: 390 - scrollbarWidth };
    const focusCalls = [];
    drawerDocument.activeElement = {
        isConnected: true,
        focus: (options) => focusCalls.push(options)
    };
    const drawerWindow = {
        innerWidth: 390,
        matchMedia: (query) => {
            assert.equal(query, "(max-width: 767.98px)");
            return media;
        },
        getComputedStyle: () => ({ paddingRight: computedPadding })
    };
    return { drawerWindow, drawerDocument, media, focusCalls };
}

test("mobile drawer blocks background scrolling and restores existing inline styles", () => {
    const environment = createDrawerEnvironment({ scrollbarWidth: 15, computedPadding: "7px" });
    const style = environment.drawerDocument.body.style;
    style.setProperty("overflow", "auto", "important");
    style.setProperty("padding-right", "7px", "important");
    let closeCalls = 0;

    const cleanup = attachPortalDrawerEffects(environment.drawerWindow, environment.drawerDocument, () => closeCalls++);
    assert.equal(style.getPropertyValue("overflow"), "hidden");
    assert.equal(style.getPropertyValue("padding-right"), "22px");
    assert.equal(closeCalls, 0);

    cleanup();
    assert.equal(style.getPropertyValue("overflow"), "auto");
    assert.equal(style.getPropertyPriority("overflow"), "important");
    assert.equal(style.getPropertyValue("padding-right"), "7px");
    assert.equal(style.getPropertyPriority("padding-right"), "important");
    assert.deepEqual(environment.focusCalls, [{ preventScroll: true }]);
});

test("touch viewport restores inherited body scrolling after close and can reopen", () => {
    const environment = createDrawerEnvironment({ computedPadding: "12px" });
    const style = environment.drawerDocument.body.style;
    const attach = () => attachPortalDrawerEffects(environment.drawerWindow, environment.drawerDocument, () => {});

    const firstCleanup = attach();
    assert.equal(style.getPropertyValue("overflow"), "hidden");
    assert.equal(style.getPropertyValue("padding-right"), "");
    firstCleanup();
    assert.equal(style.getPropertyValue("overflow"), "");
    assert.equal(style.getPropertyValue("padding-right"), "");

    const secondCleanup = attach();
    assert.equal(style.getPropertyValue("overflow"), "hidden");
    secondCleanup();
    assert.equal(style.getPropertyValue("overflow"), "");
    assert.equal(environment.drawerDocument.listenerCount("keydown"), 0);
    assert.equal(environment.media.listenerCount("change"), 0);
});

test("Escape requests closing while other keys leave the mobile drawer open", () => {
    const environment = createDrawerEnvironment();
    let closeCalls = 0;
    let prevented = 0;
    const cleanup = attachPortalDrawerEffects(environment.drawerWindow, environment.drawerDocument, () => closeCalls++);

    environment.drawerDocument.dispatch("keydown", { key: "Tab", preventDefault: () => prevented++ });
    assert.equal(closeCalls, 0);
    environment.drawerDocument.dispatch("keydown", { key: "Escape", preventDefault: () => prevented++ });
    assert.equal(closeCalls, 1);
    assert.equal(prevented, 1);
    cleanup();
    assert.equal(environment.drawerDocument.body.style.getPropertyValue("overflow"), "");
});

test("desktop resize restores page scrolling before requesting drawer close", () => {
    const environment = createDrawerEnvironment({ scrollbarWidth: 15, computedPadding: "3px" });
    const style = environment.drawerDocument.body.style;
    style.setProperty("overflow", "scroll");
    style.setProperty("padding-right", "3px");
    let closeCalls = 0;
    const cleanup = attachPortalDrawerEffects(environment.drawerWindow, environment.drawerDocument, () => {
        closeCalls++;
        assert.equal(style.getPropertyValue("overflow"), "scroll");
        assert.equal(style.getPropertyValue("padding-right"), "3px");
    });

    environment.media.dispatch("change", { matches: true });
    assert.equal(closeCalls, 0);
    assert.equal(style.getPropertyValue("overflow"), "hidden");
    environment.media.matches = false;
    environment.media.dispatch("change", { matches: false });
    assert.equal(closeCalls, 1);

    style.setProperty("overflow", "visible");
    cleanup();
    assert.equal(style.getPropertyValue("overflow"), "visible");
});

test("desktop attachment closes without changing body styles or focus", () => {
    const environment = createDrawerEnvironment({ mobile: false });
    const style = environment.drawerDocument.body.style;
    style.setProperty("overflow", "visible", "important");
    style.setProperty("padding-right", "8px");
    let closeCalls = 0;
    const cleanup = attachPortalDrawerEffects(environment.drawerWindow, environment.drawerDocument, () => closeCalls++);

    assert.equal(closeCalls, 1);
    assert.equal(style.getPropertyValue("overflow"), "visible");
    assert.equal(style.getPropertyPriority("overflow"), "important");
    assert.equal(style.getPropertyValue("padding-right"), "8px");
    assert.equal(environment.drawerDocument.listenerCount("keydown"), 0);
    assert.equal(environment.media.listenerCount("change"), 0);
    cleanup();
    assert.deepEqual(environment.focusCalls, []);
});

test("unmount cleanup detaches listeners and skips focus for disconnected elements", () => {
    const environment = createDrawerEnvironment();
    let closeCalls = 0;
    const cleanup = attachPortalDrawerEffects(environment.drawerWindow, environment.drawerDocument, () => closeCalls++);
    assert.equal(environment.drawerDocument.listenerCount("keydown"), 1);
    assert.equal(environment.media.listenerCount("change"), 1);
    environment.drawerDocument.activeElement.isConnected = false;

    cleanup();
    cleanup();
    environment.drawerDocument.dispatch("keydown", { key: "Escape", preventDefault: () => {} });
    environment.media.dispatch("change", { matches: false });
    assert.equal(closeCalls, 0);
    assert.equal(environment.drawerDocument.listenerCount("keydown"), 0);
    assert.equal(environment.media.listenerCount("change"), 0);
    assert.equal(environment.drawerDocument.body.style.getPropertyValue("overflow"), "");
    assert.deepEqual(environment.focusCalls, []);
});
