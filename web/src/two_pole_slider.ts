import noUiSlider from "nouislider";
import type {API, PartialFormatter} from "nouislider";
import {PipsMode} from "nouislider";

export type TwoPoleSliderOptions = {
    container: HTMLElement;
    breakpoint_values: number[];
    breakpoint_labels: Record<number, string>;
    lower_pole_label: string;
    upper_pole_label: string;
    tied_label: string;
    saved_lower_index: number;
    saved_upper_index: number;
    on_update: () => void;
    proxy_input_ids: [string, string];
    tied_css_class: string;
    tied_at_start_css_class: string;
    tied_at_end_css_class: string;
    label_start_css_class: string;
    label_end_css_class: string;
};

export class TwoPoleSlider {
    private slider: API;
    private saved_lower_index: number;
    private saved_upper_index: number;
    private readonly options: TwoPoleSliderOptions;

    constructor(options: TwoPoleSliderOptions) {
        this.options = options;
        this.saved_lower_index = options.saved_lower_index;
        this.saved_upper_index = options.saved_upper_index;

        const breakpoint_count = options.breakpoint_values.length;
        const tooltips: [PartialFormatter, PartialFormatter] = [
            {to: () => options.lower_pole_label},
            {to: () => options.upper_pole_label},
        ];

        this.slider = noUiSlider.create(options.container, {
            start: [this.saved_lower_index, this.saved_upper_index],
            connect: [false, true, false],
            range: {min: 0, max: breakpoint_count - 1},
            step: 1,
            margin: 0,
            format: {
                to: (value: number) => Math.round(value).toString(),
                from: (value: string) => Number.parseInt(value, 10),
            },
            tooltips,
            pips: {
                mode: PipsMode.Count,
                values: breakpoint_count,
                stepped: true,
                density: 100,
                format: {
                    to: (value: number) =>
                        options.breakpoint_labels[options.breakpoint_values[Math.round(value)]!] ??
                        "",
                },
            },
        });

        const pip_labels = options.container.querySelectorAll<HTMLElement>(".noUi-value");
        pip_labels[0]?.classList.add(options.label_start_css_class);
        pip_labels[pip_labels.length - 1]?.classList.add(options.label_end_css_class);

        // Only the slider itself is clickable by default, so this
        // creates large clickable zones to make touch interaction
        // easier.
        this.create_click_zones(breakpoint_count);

        // Move each tooltip into its own handle element rather than
        // origin (noUiSlider's own documented pattern for tooltip
        // customization). Origin spans the slider's full width and
        // is positioned via transform, which has caused version
        // fragility in the default stylesheet's special-case rule
        // for tooltips nested there. Handle is a small, fixed-size
        // element already sitting exactly at the pole, so centering
        // a tooltip within it needs no special-case CSS at all.
        const handles = options.container.querySelectorAll<HTMLElement>(".noUi-handle");
        this.slider.getTooltips()?.forEach((tooltip, index) => {
            if (tooltip) {
                handles[index]!.append(tooltip);
            }
        });

        this.slider.on("update", () => {
            this.sync_proxy_inputs();
            this.update_tied_state();
            options.on_update();
        });
    }

    current_indices(): [number, number] {
        const [lower_position, upper_position] = this.slider.get(true) as [number, number];
        return [Math.round(lower_position), Math.round(upper_position)];
    }

    is_dirty(): boolean {
        const [lower_index, upper_index] = this.current_indices();
        return lower_index !== this.saved_lower_index || upper_index !== this.saved_upper_index;
    }

    set_saved_indices(lower_index: number, upper_index: number): void {
        this.saved_lower_index = lower_index;
        this.saved_upper_index = upper_index;
    }

    reset_to_saved(): void {
        this.slider.set([this.saved_lower_index, this.saved_upper_index]);
    }

    disable(): void {
        this.slider.disable();
    }

    enable(): void {
        this.slider.enable();
    }

    // One clickable zone per breakpoint, evenly dividing the full
    // width at the midpoints between adjacent breakpoints. The first
    // and last zones are handled separately from the generic, shared
    // case below, since only they need to extend to the handle's own
    // outer edge instead of stopping at a midpoint.
    private create_click_zones(breakpoint_count: number): void {
        const zones_container = document.createElement("div");
        zones_container.className = "two-pole-slider-click-zones";

        const max_index = breakpoint_count - 1;
        const step_pct = 100 / max_index;
        for (let index = 0; index < breakpoint_count; index += 1) {
            const zone = document.createElement("div");
            zone.className = "two-pole-slider-click-zone";

            if (index === 0) {
                zone.classList.add("two-pole-slider-click-zone-start");
            } else if (index === max_index) {
                zone.classList.add("two-pole-slider-click-zone-end");
            }

            // Always set both sides; the start/end classes above
            // override just the one side they need via CSS cascade
            // order, so this is only load-bearing for middle zones.
            zone.style.setProperty(
                "--zone-left",
                index === 0 ? "0%" : `${(index - 0.5) * step_pct}%`,
            );
            zone.style.setProperty(
                "--zone-right",
                index === max_index ? "0%" : `${100 - (index + 0.5) * step_pct}%`,
            );

            zone.addEventListener("click", (event) => {
                event.stopPropagation();
                const [lower_index, upper_index] = this.current_indices();
                const tied = lower_index === upper_index;
                const hit_existing_pole = index === lower_index || index === upper_index;

                let pole_to_move: "lower" | "upper" | null;
                if (hit_existing_pole) {
                    if (tied) {
                        pole_to_move = null;
                    } else if (index === lower_index) {
                        pole_to_move = "upper";
                    } else {
                        pole_to_move = "lower";
                    }
                } else if (tied) {
                    // Distance to each pole is identical when tied,
                    // so direction decides which one moves. Moving
                    // the wrong one rightward past the other's tied
                    // position would force noUiSlider to drag both
                    // together, to keep lower <= upper.
                    pole_to_move = index > lower_index ? "upper" : "lower";
                } else {
                    pole_to_move =
                        Math.abs(index - lower_index) <= Math.abs(index - upper_index)
                            ? "lower"
                            : "upper";
                }

                if (pole_to_move === "lower") {
                    this.slider.set([index, null]);
                } else if (pole_to_move === "upper") {
                    this.slider.set([null, index]);
                }
            });
            zones_container.append(zone);
        }
        this.options.container.append(zones_container);
    }

    private sync_proxy_inputs(): void {
        const [lower_index, upper_index] = this.current_indices();
        const [lower_input_id, upper_input_id] = this.options.proxy_input_ids;
        const breakpoint_values = this.options.breakpoint_values;
        const lower_input = document.querySelector<HTMLInputElement>(`#${lower_input_id}`)!;
        const upper_input = document.querySelector<HTMLInputElement>(`#${upper_input_id}`)!;
        lower_input.value = breakpoint_values[lower_index]!.toString();
        upper_input.value = breakpoint_values[upper_index]!.toString();
        lower_input.dispatchEvent(new Event("change", {bubbles: true}));
        upper_input.dispatchEvent(new Event("change", {bubbles: true}));
    }

    private update_tied_state(): void {
        const {options} = this;
        const [lower_index, upper_index] = this.current_indices();
        const max_index = options.breakpoint_values.length - 1;
        const tied = lower_index === upper_index;
        const at_start = tied && lower_index === 0;
        const at_end = tied && lower_index === max_index;

        options.container.classList.toggle(options.tied_css_class, tied && !at_start && !at_end);
        options.container.classList.toggle(options.tied_at_start_css_class, at_start);
        options.container.classList.toggle(options.tied_at_end_css_class, at_end);

        // Separate from tied state, since an untied handle can
        // still sit at an edge.
        options.container.classList.toggle("two-pole-slider-lower-at-start", lower_index === 0);
        options.container.classList.toggle(
            "two-pole-slider-upper-at-end",
            upper_index === max_index,
        );

        const tooltips = this.slider.getTooltips();
        const lower_tooltip = tooltips ? tooltips[0] : false;
        const upper_tooltip = tooltips ? tooltips[1] : false;
        if (!lower_tooltip || !upper_tooltip) {
            return;
        }

        upper_tooltip.textContent = tied ? options.tied_label : options.upper_pole_label;

        if (!tied) {
            return;
        }

        // The merged tooltip's own translate offset depends on the
        // handle's actual measured width, which can't be known
        // ahead of time in CSS alone.
        const handle_width = upper_tooltip.parentElement!.getBoundingClientRect().width;
        options.container.style.setProperty("--measured-handle-width", `${handle_width}px`);
    }
}
