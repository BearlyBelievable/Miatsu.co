"use strict";

const assert = require("node:assert/strict");

const {JSDOM} = require("jsdom");

const {set_global, zrequire} = require("./lib/namespace.cjs");
const {run_test} = require("./lib/test.cjs");

const {window} = new JSDOM("");
set_global("document", window.document);
set_global("getComputedStyle", window.getComputedStyle.bind(window));
set_global("HTMLElement", window.HTMLElement);
set_global("Event", window.Event);

const {TwoPoleSlider} = zrequire("two_pole_slider");

function get_raw_slider(two_pole_slider) {
    // @ts-expect-error accessing private internals for direct testing
    return two_pole_slider.slider;
}

const BREAKPOINT_VALUES = [1, 2, 3, 4, 5];
const BREAKPOINT_LABELS = {
    1: "Alpha",
    2: "Beta",
    3: "Gamma",
    4: "Delta",
    5: "Epsilon",
};

function make_slider(overrides = {}) {
    document.body.innerHTML = "";

    const container = document.createElement("div");
    document.body.append(container);

    const lower_input = document.createElement("input");
    lower_input.id = "test_lower_input";
    document.body.append(lower_input);

    const upper_input = document.createElement("input");
    upper_input.id = "test_upper_input";
    document.body.append(upper_input);

    const options = {
        container,
        breakpoint_values: BREAKPOINT_VALUES,
        breakpoint_labels: BREAKPOINT_LABELS,
        lower_pole_label: "Max",
        upper_pole_label: "Min",
        tied_label: "Clamp to",
        saved_lower_index: 0,
        saved_upper_index: 4,
        on_update() {},
        proxy_input_ids: ["test_lower_input", "test_upper_input"],
        tied_css_class: "two-pole-slider-tied",
        tied_at_start_css_class: "two-pole-slider-tied-at-start",
        tied_at_end_css_class: "two-pole-slider-tied-at-end",
        label_start_css_class: "two-pole-slider-label-start",
        label_end_css_class: "two-pole-slider-label-end",
        ...overrides,
    };

    const slider = new TwoPoleSlider(options);
    return {slider, container, lower_input, upper_input};
}

run_test("initial current_indices matches saved indices", () => {
    const {slider} = make_slider();
    assert.deepEqual(slider.current_indices(), [0, 4]);
});

run_test("is_dirty is false initially", () => {
    const {slider} = make_slider();
    assert.equal(slider.is_dirty(), false);
});

run_test("set_saved_indices then reset_to_saved moves the slider back", () => {
    const {slider} = make_slider();
    slider.set_saved_indices(1, 3);
    get_raw_slider(slider).set([2, 2]);
    assert.deepEqual(slider.current_indices(), [2, 2]);
    assert.equal(slider.is_dirty(), true);

    slider.reset_to_saved();
    assert.deepEqual(slider.current_indices(), [1, 3]);
    assert.equal(slider.is_dirty(), false);
});

run_test("sync_proxy_inputs updates the proxy inputs to breakpoint values", () => {
    const {slider, lower_input, upper_input} = make_slider();
    get_raw_slider(slider).set([1, 3]);
    assert.equal(lower_input.value, "2");
    assert.equal(upper_input.value, "4");
});

run_test("pip markers match breakpoints exactly, with no extra in-between ticks", () => {
    const {container} = make_slider();
    // "Count" mode generates a marker every 1% by default, alongside
    // the labeled pips at our actual breakpoints, unless filtered out,
    // which is why we're not using it.
    const markers = container.querySelectorAll(".noUi-marker");
    assert.equal(markers.length, BREAKPOINT_VALUES.length);
});

run_test("clicking the start zone sets the value to the first breakpoint", () => {
    const {slider, container} = make_slider();
    get_raw_slider(slider).set([2, 4]);
    const zones = container.querySelectorAll(".two-pole-slider-click-zone");
    zones[0].dispatchEvent(new Event("click"));
    const [lower_index] = get_raw_slider(slider).get(true);
    assert.equal(Math.round(lower_index), 0);
});

run_test("clicking the end zone sets the value to the last breakpoint", () => {
    const {slider, container} = make_slider();
    get_raw_slider(slider).set([0, 2]);
    const zones = [...container.querySelectorAll(".two-pole-slider-click-zone")];
    zones.at(-1).dispatchEvent(new Event("click"));
    const [, upper_index] = get_raw_slider(slider).get(true);
    assert.equal(Math.round(upper_index), 4);
});

run_test("clicking a middle zone moves the nearer handle to it", () => {
    const {slider, container} = make_slider();
    get_raw_slider(slider).set([0, 4]);
    const zones = container.querySelectorAll(".two-pole-slider-click-zone");
    zones[1].dispatchEvent(new Event("click"));
    const [lower_index, upper_index] = get_raw_slider(slider).get(true);
    assert.equal(Math.round(lower_index), 1);
    assert.equal(Math.round(upper_index), 4);
});

run_test(
    "clicking the zone the upper pole already occupies collapses the lower pole onto it",
    () => {
        const {slider, container} = make_slider();
        get_raw_slider(slider).set([0, 3]);
        const zones = container.querySelectorAll(".two-pole-slider-click-zone");
        zones[3].dispatchEvent(new Event("click"));
        const [lower_index, upper_index] = get_raw_slider(slider).get(true);
        assert.equal(Math.round(lower_index), 3);
        assert.equal(Math.round(upper_index), 3);
    },
);

run_test(
    "clicking the zone the lower pole already occupies collapses the upper pole onto it",
    () => {
        const {slider, container} = make_slider();
        get_raw_slider(slider).set([1, 4]);
        const zones = container.querySelectorAll(".two-pole-slider-click-zone");
        zones[1].dispatchEvent(new Event("click"));
        const [lower_index, upper_index] = get_raw_slider(slider).get(true);
        assert.equal(Math.round(lower_index), 1);
        assert.equal(Math.round(upper_index), 1);
    },
);

run_test("clicking the zone a tied pair already occupies does nothing", () => {
    const {slider, container} = make_slider();
    get_raw_slider(slider).set([2, 2]);
    const zones = container.querySelectorAll(".two-pole-slider-click-zone");
    zones[2].dispatchEvent(new Event("click"));
    const [lower_index, upper_index] = get_raw_slider(slider).get(true);
    assert.equal(Math.round(lower_index), 2);
    assert.equal(Math.round(upper_index), 2);
});

run_test("clicking right of a tied pair moves only the upper pole", () => {
    const {slider, container} = make_slider();
    get_raw_slider(slider).set([2, 2]);
    const zones = container.querySelectorAll(".two-pole-slider-click-zone");
    zones[4].dispatchEvent(new Event("click"));
    const [lower_index, upper_index] = get_raw_slider(slider).get(true);
    assert.equal(Math.round(lower_index), 2);
    assert.equal(Math.round(upper_index), 4);
});

run_test("clicking left of a tied pair moves only the lower pole", () => {
    const {slider, container} = make_slider();
    get_raw_slider(slider).set([2, 2]);
    const zones = container.querySelectorAll(".two-pole-slider-click-zone");
    zones[0].dispatchEvent(new Event("click"));
    const [lower_index, upper_index] = get_raw_slider(slider).get(true);
    assert.equal(Math.round(lower_index), 0);
    assert.equal(Math.round(upper_index), 2);
});

run_test("all five breakpoints have their own click zone", () => {
    const {container} = make_slider();
    const zones = container.querySelectorAll(".two-pole-slider-click-zone");
    assert.equal(zones.length, BREAKPOINT_VALUES.length);
});

run_test("start and end zones have both sides set, not just the edge-anchored one", () => {
    const {container} = make_slider();
    const zones = [...container.querySelectorAll(".two-pole-slider-click-zone")];
    const start_zone = zones[0];
    const end_zone = zones.at(-1);
    assert.ok(start_zone.style.getPropertyValue("--zone-left"));
    assert.ok(start_zone.style.getPropertyValue("--zone-right"));
    assert.ok(end_zone.style.getPropertyValue("--zone-left"));
    assert.ok(end_zone.style.getPropertyValue("--zone-right"));
});

run_test("tooltips are moved into their own handle elements", () => {
    const {container} = make_slider();
    const handles = container.querySelectorAll(".noUi-handle");
    for (const handle of handles) {
        assert.ok(handle.querySelector(".noUi-tooltip"));
    }
});

run_test("independent tooltip at the start toggles the lower-at-start class", () => {
    const {slider, container} = make_slider();
    get_raw_slider(slider).set([0, 2]);
    assert.ok(container.classList.contains("two-pole-slider-lower-at-start"));
});

run_test("independent tooltip at the end toggles the upper-at-end class", () => {
    const {slider, container} = make_slider();
    get_raw_slider(slider).set([2, 4]);
    assert.ok(container.classList.contains("two-pole-slider-upper-at-end"));
});

run_test("tied state sets --measured-handle-width from the handle's own measured width", () => {
    const {slider, container} = make_slider();
    const upper_tooltip = container.querySelectorAll(".noUi-tooltip")[1];
    upper_tooltip.parentElement.getBoundingClientRect = () => ({width: 16});
    get_raw_slider(slider).set([0, 0]);
    assert.equal(container.style.getPropertyValue("--measured-handle-width"), "16px");
});

run_test("tied state toggles the correct class in the middle", () => {
    const {slider, container} = make_slider();
    get_raw_slider(slider).set([2, 2]);
    assert.ok(container.classList.contains("two-pole-slider-tied"));
    assert.ok(!container.classList.contains("two-pole-slider-tied-at-start"));
    assert.ok(!container.classList.contains("two-pole-slider-tied-at-end"));
});

run_test("tied state toggles the start class at the first breakpoint", () => {
    const {slider, container} = make_slider();
    get_raw_slider(slider).set([0, 0]);
    assert.ok(container.classList.contains("two-pole-slider-tied-at-start"));
    assert.ok(!container.classList.contains("two-pole-slider-tied"));
});

run_test("tied state toggles the end class at the last breakpoint", () => {
    const {slider, container} = make_slider();
    get_raw_slider(slider).set([4, 4]);
    assert.ok(container.classList.contains("two-pole-slider-tied-at-end"));
    assert.ok(!container.classList.contains("two-pole-slider-tied"));
});

run_test("on_update is called on a slider update", () => {
    let update_count = 0;
    const {slider} = make_slider({
        on_update() {
            update_count += 1;
        },
    });
    const before_count = update_count;
    get_raw_slider(slider).set([1, 3]);
    assert.ok(update_count > before_count);
});

run_test("merged tooltip text switches between tied_label and upper_pole_label", () => {
    const {slider, container} = make_slider();
    const upper_tooltip = container.querySelectorAll(".noUi-tooltip")[1];
    get_raw_slider(slider).set([2, 2]);
    assert.equal(upper_tooltip.textContent, "Clamp to");

    get_raw_slider(slider).set([1, 2]);
    assert.equal(upper_tooltip.textContent, "Min");
});

run_test("clicking exactly between the poles moves the lower pole", () => {
    const {slider, container} = make_slider();
    const zones = container.querySelectorAll(".two-pole-slider-click-zone");
    zones[2].dispatchEvent(new Event("click"));
    const [lower_index, upper_index] = get_raw_slider(slider).get(true);
    assert.equal(Math.round(lower_index), 2);
    assert.equal(Math.round(upper_index), 4);
});

run_test("disable and enable set/clear the native disabled attribute", () => {
    const {slider, container} = make_slider();
    slider.disable();
    assert.ok(container.hasAttribute("disabled"));
    slider.enable();
    assert.ok(!container.hasAttribute("disabled"));
});
