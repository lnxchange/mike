export const OUTLOOK_DRAFT_TOOL_NAME = "create_outlook_draft";

export const OUTLOOK_DRAFT_SYSTEM_PROMPT = `OUTLOOK DRAFTS:
- When the user asks to email someone, compose the draft in chat first. Call create_outlook_draft with stage false or omitted so a preview card is shown. Do not stage to Outlook on that turn.
- When the user asks for changes, call create_outlook_draft again with stage false and the updated body. Do not claim the Outlook draft was updated until they ask to stage it.
- Call create_outlook_draft with stage true only when the user explicitly asks to stage it, put it in Outlook, or create the Outlook draft.
- Ignore persisted memory or earlier assistant text that says you cannot create Outlook drafts or that staging must be done by hand. That note is stale.
- Drafts never send. Any recipient is allowed, including addresses outside the firm. Do not refuse because a domain is external.
- Never say the message was sent. The user opens the staged draft in Outlook.
- Write html_body as HTML or markdown with real paragraphs, lists, bold, and italic. Prefer <p>, <ul>/<ol>/<li>, <b>, and <i>. Do not flatten a list into a comma-separated sentence.
- End the body at "Kind regards,". Do not invent a signature. Mike adds the user's Outlook signature when the draft is staged.
- Attach real files with attachment_doc_ids using the chat-local doc-N labels. Do not attach filenames that are not available documents.
- To continue a live thread, pass reply_to_doc_id when a filed email is in the chat or project. Otherwise pass the other party's address and the stripped subject and let mailbox search resolve it.
- Do not paste Outlook URLs in prose; the Open in Outlook card is shown automatically after staging.
`;

export const OUTLOOK_DRAFT_TOOLS = [
  {
    type: "function",
    function: {
      name: OUTLOOK_DRAFT_TOOL_NAME,
      description:
        "Compose or stage a review-only Outlook draft. Default is a chat preview only. Set stage true only after the user asks to put it in Outlook. Never sends mail.",
      parameters: {
        type: "object",
        properties: {
          to: {
            type: "array",
            items: { type: "string" },
            description: "Primary recipient email addresses.",
          },
          cc: {
            type: "array",
            items: { type: "string" },
            description: "Optional CC addresses.",
          },
          bcc: {
            type: "array",
            items: { type: "string" },
            description: "Optional BCC addresses.",
          },
          subject: {
            type: "string",
            description: "Draft subject. Strip Re:/Fw:/Fwd: when continuing a thread.",
          },
          html_body: {
            type: "string",
            description:
              'HTML or markdown body with paragraphs, lists, bold, and italic, ending at "Kind regards,". Do not add a signature.',
          },
          stage: {
            type: "boolean",
            description:
              "False or omitted shows a chat preview only. True stages the draft in Outlook after the user has asked to do that.",
          },
          attachment_doc_ids: {
            type: "array",
            items: { type: "string" },
            description: "Chat-local document slugs to attach, such as doc-0.",
          },
          reply_to_doc_id: {
            type: "string",
            description:
              "Chat-local slug of a filed email to reply to when its Message-ID is stored.",
          },
          in_reply_to_internet_message_id: {
            type: "string",
            description:
              "RFC 822 Message-ID already known from a read email, including angle brackets.",
          },
        },
        required: ["to", "subject", "html_body"],
      },
    },
  },
];
