import assert from "minimalistic-assert";
import * as z from "zod/mini";

import render_dropdown_options_widget from "../templates/settings/dropdown_options_widget.hbs";

import * as bulk_remediation_ui from "./bulk_remediation_ui.ts";
import * as channel from "./channel.ts";
import {$t} from "./i18n.ts";
import {realm_user_settings_defaults} from "./realm_user_settings_defaults.ts";
import * as settings_config from "./settings_config.ts";
import {current_user, realm} from "./state_data.ts";
import {TwoPoleSlider} from "./two_pole_slider.ts";
import {user_settings} from "./user_settings.ts";

const distribution_response_schema = z.object({
    counts: z.record(z.string(), z.number()),
});

const policy_status_response_schema = z.object({
    max: z.number(),
    min: z.number(),
    running: z.boolean(),
    failed: z.optional(z.boolean()),
    processed_count: z.optional(z.number()),
    total_violating_count: z.optional(z.number()),
});

function hide_save_button_controls(): void {
    const controls = document.querySelector<HTMLElement>(
        "#org-email-visibility-policy .save-button-controls",
    );
    controls?.classList.add("hide");
}

// Derived from settings_config.email_address_visibility_values (the
// same object the settings dropdown itself uses). Object key order
// is preserved in JS, so this stays in sync with that object
// automatically, matching UserProfile.EMAIL_ADDRESS_VISIBILITY_TYPES
// on the backend (zerver/models/users.py).
const OPENNESS_ORDER = Object.values(settings_config.email_address_visibility_values).map(
    (value) => value.code,
);

// Mirrors zerver.lib.users.email_address_visibility_options_within_policy.
export function get_allowed_email_address_visibility_values(): Record<
    string,
    settings_config.SettingDescription<number>
> {
    const max_index = OPENNESS_ORDER.indexOf(realm.realm_email_address_visibility_max);
    const min_index = OPENNESS_ORDER.indexOf(realm.realm_email_address_visibility_min);
    return Object.fromEntries(
        Object.entries(settings_config.email_address_visibility_values).filter(([, value]) => {
            const value_index = OPENNESS_ORDER.indexOf(value.code);
            return value_index >= max_index && value_index <= min_index;
        }),
    );
}

const VALUE_LABELS_BY_KEY: Record<string, string> = {
    everyone: $t({defaultMessage: "Everyone"}),
    members: $t({defaultMessage: "Members"}),
    moderators: $t({defaultMessage: "Moderators"}),
    admins_only: $t({defaultMessage: "Admins"}),
    nobody: $t({defaultMessage: "Nobody"}),
};

const VALUE_LABELS: Record<number, string> = Object.fromEntries(
    Object.entries(settings_config.email_address_visibility_values).map(([key, value]) => {
        const label = VALUE_LABELS_BY_KEY[key];
        assert(label !== undefined, `no label for ${key}`);
        return [value.code, label];
    }),
);

let two_pole_slider: TwoPoleSlider | undefined;
let saved_max_index = 0;
let saved_min_index = OPENNESS_ORDER.length - 1;
let distribution: Record<number, number> = {};

function index_of_value(value: number): number {
    return OPENNESS_ORDER.indexOf(value);
}

function count_between(start_index: number, end_index_exclusive: number): number {
    let total = 0;
    for (let index = start_index; index < end_index_exclusive; index += 1) {
        total += distribution[OPENNESS_ORDER[index]!] ?? 0;
    }
    return total;
}

function set_impact_message(text: string): void {
    const impact = document.querySelector<HTMLElement>(".email-visibility-policy-impact");
    if (impact === null) {
        return;
    }
    if (text === "") {
        impact.classList.add("hide");
        return;
    }
    const label = impact.querySelector<HTMLElement>(".banner-label");
    if (label !== null) {
        label.textContent = text;
    }
    impact.classList.remove("hide");
}

function update_impact_readout(): void {
    if (two_pole_slider === undefined) {
        return;
    }
    const [max_index, min_index] = two_pole_slider.current_indices();

    let forced_less_visible_count: number;
    if (max_index > saved_max_index) {
        forced_less_visible_count = count_between(saved_max_index, max_index);
    } else {
        forced_less_visible_count = 0;
    }
    let forced_more_visible_count: number;
    if (min_index < saved_min_index) {
        forced_more_visible_count = count_between(min_index + 1, saved_min_index + 1);
    } else {
        forced_more_visible_count = 0;
    }

    if (!two_pole_slider.is_dirty()) {
        set_impact_message("");
        return;
    }

    if (forced_less_visible_count > 0 && forced_more_visible_count > 0) {
        set_impact_message(
            $t(
                {
                    // Max's effect (left pole) is stated first,
                    // matching the left-to-right order of the poles
                    // themselves.
                    defaultMessage:
                        "{forced_less_visible_count} user emails will be less visible, {forced_more_visible_count} user emails will be more visible.",
                },
                {forced_less_visible_count, forced_more_visible_count},
            ),
        );
    } else if (forced_less_visible_count > 0) {
        set_impact_message(
            $t(
                {defaultMessage: "{forced_less_visible_count} user emails will be less visible."},
                {forced_less_visible_count},
            ),
        );
    } else if (forced_more_visible_count > 0) {
        set_impact_message(
            $t(
                {defaultMessage: "{forced_more_visible_count} user emails will be more visible."},
                {forced_more_visible_count},
            ),
        );
    } else {
        set_impact_message("");
    }
}

const slider_widget: bulk_remediation_ui.LockableWidget = {
    disable() {
        two_pole_slider?.disable();
    },
    enable() {
        two_pole_slider?.enable();
    },
    set_message: set_impact_message,
};

function show_locked_state(total_violating_count: number): void {
    hide_save_button_controls();
    bulk_remediation_ui.lock_widget(
        slider_widget,
        bulk_remediation_ui.get_running_message(total_violating_count),
    );
}

function show_read_only_state(): void {
    hide_save_button_controls();
    bulk_remediation_ui.lock_widget(slider_widget, "");
}

function clear_locked_state(): void {
    bulk_remediation_ui.unlock_widget(slider_widget);
    update_impact_readout();
}

function show_failed_state(processed_count: number, total_violating_count: number): void {
    bulk_remediation_ui.unlock_widget(
        slider_widget,
        bulk_remediation_ui.get_failed_message(processed_count, total_violating_count),
    );
}

function re_render_email_visibility_dropdowns(): void {
    // Re-renders the dropdown options, since realm_user_settings_defaults's
    // own dispatch only re-syncs the selected value, not the options
    // list itself.
    const allowed_values = get_allowed_email_address_visibility_values();
    const rendered_options = render_dropdown_options_widget({
        option_values: Object.values(allowed_values),
    });
    const current_values: Record<string, number> = {
        realm_: realm_user_settings_defaults.email_address_visibility,
        user_: user_settings.email_address_visibility,
    };
    for (const [prefix, current_value] of Object.entries(current_values)) {
        const dropdown = document.querySelector<HTMLSelectElement>(
            `#${prefix}email_address_visibility`,
        );
        if (dropdown !== null) {
            dropdown.innerHTML = rendered_options;
            dropdown.value = current_value.toString();
        }
    }
}

export function handle_policy_update_event(data: {
    running: boolean;
    total_violating_count: number;
}): void {
    re_render_email_visibility_dropdowns();
    saved_max_index = index_of_value(realm.realm_email_address_visibility_max);
    saved_min_index = index_of_value(realm.realm_email_address_visibility_min);
    two_pole_slider?.set_saved_indices(saved_max_index, saved_min_index);
    update_impact_readout();
    if (data.running) {
        show_locked_state(data.total_violating_count);
    } else {
        clear_locked_state();
    }
}

export function handle_remediation_failed_event(): void {
    // Re-fetch status for the actual counts, reusing the exact same
    // display path the initial page load already uses for a failure
    // found there.
    void channel.get({
        url: "/json/realm/email_visibility_policy",
        success(raw_data) {
            const data = policy_status_response_schema.parse(raw_data);
            if (data.failed) {
                show_failed_state(data.processed_count ?? 0, data.total_violating_count ?? 0);
            }
        },
    });
}

export function handle_remediation_completed_event(): void {
    clear_locked_state();
}

export function reset_slider_to_saved(): void {
    two_pole_slider?.reset_to_saved();
    update_impact_readout();
}

function create_slider(container: HTMLElement): void {
    two_pole_slider = new TwoPoleSlider({
        container,
        breakpoint_values: OPENNESS_ORDER,
        breakpoint_labels: VALUE_LABELS,
        lower_pole_label: $t({defaultMessage: "Max"}),
        upper_pole_label: $t({defaultMessage: "Min"}),
        tied_label: $t({defaultMessage: "Clamp to"}),
        saved_lower_index: saved_max_index,
        saved_upper_index: saved_min_index,
        on_update: update_impact_readout,
        proxy_input_ids: [
            "id_realm_email_address_visibility_max",
            "id_realm_email_address_visibility_min",
        ],
        tied_css_class: "two-pole-slider-tied",
        tied_at_start_css_class: "two-pole-slider-tied-at-start",
        tied_at_end_css_class: "two-pole-slider-tied-at-end",
        label_start_css_class: "two-pole-slider-label-start",
        label_end_css_class: "two-pole-slider-label-end",
    });
}

export function setup(): void {
    const $slider_container = document.querySelector<HTMLElement>(
        "#email_visibility_policy_slider",
    );
    if ($slider_container === null) {
        return;
    }

    void channel.get({
        url: "/json/realm/email_visibility_policy/distribution",
        success(raw_data) {
            const data = distribution_response_schema.parse(raw_data);
            distribution = Object.fromEntries(
                Object.entries(data.counts).map(([key, value]) => [Number(key), value]),
            );
        },
    });

    void channel.get({
        url: "/json/realm/email_visibility_policy",
        success(raw_data) {
            const data = policy_status_response_schema.parse(raw_data);
            saved_max_index = index_of_value(data.max);
            saved_min_index = index_of_value(data.min);

            // The slider is created here once its real starting position
            // is known. Unlike a settings toggle revealing a sub-setting,
            // this fetch resolves asynchronously after page load, to
            // avoid a placeholder reposition for something the user
            // never triggered.
            create_slider($slider_container);

            if (!current_user.is_owner) {
                show_read_only_state();
                return;
            }

            if (data.running) {
                show_locked_state(data.total_violating_count ?? 0);
            } else if (data.failed) {
                // Stays visible on every future page load, not only
                // to whoever was connected at the exact moment it
                // happened (see handle_remediation_failed_event for
                // the live-push counterpart to this).
                show_failed_state(data.processed_count ?? 0, data.total_violating_count ?? 0);
            }
        },
    });
}
