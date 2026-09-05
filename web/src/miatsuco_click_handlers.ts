import $ from "jquery";
import assert from "minimalistic-assert";

import * as compose_reply from "./compose_reply.ts";
import * as message_lists from "./message_lists.ts";
import * as rows from "./rows.ts";

export function initialize(): void {
    // Clears the touch-controls popover when tapping outside a message row.
    $("body").on("click", (e) => {
        if ($(e.target).closest(".message_row").length === 0) {
            $(".selected_msg_for_touchscreen").removeClass("selected_msg_for_touchscreen");
        }
    });

    $("body").on("click", ".quote_message_button", function (e) {
        assert(message_lists.current !== undefined);
        const $row = message_lists.current.get_row(rows.id($(this).closest(".message_row")));
        compose_reply.quote_messages({trigger: "message controls", message_id: rows.id($row)});
        e.stopPropagation();
    });
}
