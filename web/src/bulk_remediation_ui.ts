// Generic frontend counterpart to the backend's bulk_remediation
// app. Any UI element that fires a job to bulk change user data can
// use these to lock/unlock the widget and display standard
// progress/failure messages.
import {$t} from "./i18n.ts";

export type LockableWidget = {
    disable: () => void;
    enable: () => void;
    set_message: (text: string) => void;
};

export function lock_widget(widget: LockableWidget, message: string): void {
    widget.disable();
    widget.set_message(message);
}

export function unlock_widget(widget: LockableWidget, message = ""): void {
    widget.enable();
    widget.set_message(message);
}

export function get_running_message(total_violating_count: number): string {
    return $t(
        {defaultMessage: "Applying changes: updating {total_violating_count} users."},
        {total_violating_count},
    );
}

export function get_failed_message(processed_count: number, total_violating_count: number): string {
    return $t(
        {
            defaultMessage:
                "The last change encountered an error after updating {processed_count} of {total_violating_count} users. Applying a new change will retry the remaining users.",
        },
        {processed_count, total_violating_count},
    );
}
