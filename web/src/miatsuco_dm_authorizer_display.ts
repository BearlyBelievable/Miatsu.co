import $ from "jquery";

import render_input_pill from "../templates/input_pill.hbs";

import {$t} from "./i18n.ts";
import * as people from "./people.ts";
import {realm} from "./state_data.ts";
import type {GroupSettingValue} from "./state_data.ts";
import * as user_group_popover from "./user_group_popover.ts";
import * as user_groups from "./user_groups.ts";

// MiAtSu.Co fork: the "restrict direct messages to only those who can authorize
// them" personal setting (miatsuco_restrict_dms_to_authorizers) is hard to act
// on without knowing who those authorizers currently are. When the setting is
// enabled, this module shows the current members of the realm's
// direct_message_permission_group as read-only pills beneath the checkbox. The
// pills are shown/hidden purely by the checkbox state (see settings.css), so
// there is no separate expander control here.
//
// The pills are deliberately view-only, distinct from the editable
// group-setting pickers in admin settings:
//   - Group and role values render as group pills carrying data-user-group-id,
//     which open the shared user-group popover in its view_only mode (see
//     user_group_popover.ts): the popover lists members but hides navigation
//     into group administration. Its member list is already access-filtered, so
//     a guest only ever sees members they are otherwise allowed to see.
//   - Individually-listed users render as non-interactive pills (no profile
//     card, no click target), since this surface is purely informational.

function render_group_pill(group_id: number): string | undefined {
    const group = user_groups.maybe_get_user_group_from_id(group_id);
    if (group === undefined) {
        return undefined;
    }
    const member_count = user_groups.get_recursive_group_members(group).size;
    return render_input_pill({
        display_value: user_groups.get_display_group_name(group.name),
        group_id,
        show_group_members_count: true,
        group_members_count: member_count,
        // Read-only display: suppress the removable-pill [x] close button.
        disabled: true,
    });
}

function render_user_pill(user_id: number): string | undefined {
    const user = people.maybe_get_user_by_id(user_id, true);
    if (user === undefined) {
        return undefined;
    }
    // A plain, non-interactive pill: no data-user-id and no profile-card
    // class, so it renders the name without any click behavior. disabled
    // suppresses the removable-pill [x] close button.
    return render_input_pill({
        display_value: people.get_full_name(user_id),
        disabled: true,
    });
}

// Exported for testing.
export function build_pills_html(setting_value: GroupSettingValue): string {
    const group_ids: number[] =
        typeof setting_value === "number" ? [setting_value] : [...setting_value.direct_subgroups];
    const member_ids: number[] =
        typeof setting_value === "number" ? [] : [...setting_value.direct_members];

    const pieces: string[] = [];
    for (const group_id of group_ids) {
        const html = render_group_pill(group_id);
        if (html !== undefined) {
            pieces.push(html);
        }
    }
    for (const user_id of member_ids) {
        const html = render_user_pill(user_id);
        if (html !== undefined) {
            pieces.push(html);
        }
    }
    return pieces.join("");
}

export function render_pills($container: JQuery): void {
    const $pills = $container.find(".miatsuco-dm-authorizers-pills");
    if ($pills.length === 0) {
        return;
    }
    const html = build_pills_html(realm.realm_direct_message_permission_group);
    if (html === "") {
        $pills.empty();
        $pills.append(
            $("<span>")
                .addClass("miatsuco-dm-authorizers-empty")
                .text(
                    $t({
                        defaultMessage: "No one can currently authorize direct messages.",
                    }),
                ),
        );
        return;
    }
    $pills.html(html);
}

export function set_up($container: JQuery): void {
    const $disclosure = $container.find(".miatsuco-dm-authorizers");
    if ($disclosure.length === 0) {
        return;
    }

    // The settings_checkbox partial renders an empty container for this
    // setting's content. Mount a short hint and the read-only pill container
    // inside it, so they belong to the setting's own block (and do not pick up
    // the vertical spacing between separate settings). Visibility is driven
    // entirely by the checkbox state in CSS.
    $disclosure.empty();
    $disclosure.append(
        $("<div>")
            .addClass("miatsuco-dm-authorizers-hint")
            .text($t({defaultMessage: "People who can authorize direct messages:"})),
    );
    $disclosure.append($("<div>").addClass("miatsuco-dm-authorizers-pills pill-container"));

    render_pills($container);

    // Open the shared user-group popover in view_only mode when a group or
    // role pill is clicked. Individual-user pills carry no data-user-group-id
    // and are ignored here.
    $disclosure.on(
        "click",
        ".miatsuco-dm-authorizers-pills .pill[data-user-group-id]",
        function (this: HTMLElement, e) {
            e.stopPropagation();
            user_group_popover.toggle_user_group_info_popover(this, undefined, true);
        },
    );
}

// Called from the realm-settings dispatch path when
// direct_message_permission_group changes, so the displayed pills stay current.
export function rerender_if_present(): void {
    const $container = $("#settings_content");
    if ($container.length === 0) {
        return;
    }
    render_pills($container);
}
