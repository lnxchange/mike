export const OUTLOOK_DRAFT_TOOL_NAME = "create_outlook_draft";

export const OUTLOOK_DRAFT_SYSTEM_PROMPT = `OUTLOOK DRAFTS:
- You can stage review-only Outlook drafts. When the user asks to email someone, draft a message, attach a file to an email, or continue a mailbox thread, call create_outlook_draft in that turn. Do not say you lack this ability.
- Ignore persisted memory or earlier assistant text that says you cannot create Outlook drafts or that staging must be done by hand. That note is stale.
- Drafts never send. Any recipient is allowed, including addresses outside the firm. Do not refuse because a domain is external.
- Never say the message was sent. The user opens the draft in Outlook.
- End the HTML body at "Kind regards,". Do not invent a signature block.
- Attach real files with attachment_doc_ids using the chat-local doc-N labels. Do not attach filenames that are not available documents.
- To continue a live thread, pass reply_to_doc_id when a filed email is in the chat or project. Otherwise pass the other party's address and the stripped subject and let mailbox search resolve it.
- Do not paste Outlook URLs in prose; the Open in Outlook card is shown automatically.
`;

export const OUTLOOK_DRAFT_TOOLS = [
  {
    type: "function",
    function: {
      name: OUTLOOK_DRAFT_TOOL_NAME,
      description:
        "Stage a review-only Outlook draft in the signed-in user's mailbox. Never sends mail. Attach authorised Mike documents and join a live thread when a Message-ID or a single mailbox match is available.",
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
              'HTML body ending at "Kind regards,". Do not add a signature.',
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
