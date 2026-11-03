// FAQ copy for the home page. Plain strings so tests can check the exact
// wording and the claims scan can read them.

export interface FaqItem {
  question: string;
  answer: string;
}

export const FAQ: readonly FaqItem[] = [
  {
    question: "What does SafeLabs Guard stop?",
    answer:
      "An agent acting on the wrong object, or on instructions hidden in a sign or a spoken command. It blocks the action when the proposal and the evidence disagree.",
  },
  {
    question: "Does an AI model make the final decision?",
    answer:
      "Not for the Guard's decision. Muse Spark proposes an action, and fixed code, not an AI model, decides whether Guard allows or blocks it. The agent can also choose to hold on its own.",
  },
  {
    question: "What happens if a part is down?",
    answer: "If a required part such as SAM or OCR is unavailable, Guard blocks the turn and nothing executes. If the agent model is unavailable, the agent holds. Nothing ships on a guess.",
  },
  {
    question: "Is the shipment real?",
    answer: "No. The shipment is simulated. No goods, payments or carriers are involved.",
  },
  {
    question: "What did it catch in testing, and what didn't it?",
    answer:
      "In live tests it blocked wrong objects, such as a banana or a laptop in place of the expected item, and flagged signs and spoken commands that tried to give the agent instructions. The model alone often resisted those injections, so the guard's clearest demonstrated win is the wrong object. In one test image SAM did not find the cable, so the guard blocked.",
  },
  {
    question: "Which languages does voice support?",
    answer: "English only. Other languages are blocked as a safe default.",
  },
  {
    question: "Do you store my camera images or audio?",
    answer:
      "No. The server does not save your images or audio. Each is processed to answer that one request and then discarded. What you send to Meta's models is covered by Meta's own terms.",
  },
  {
    question: "Can it verify my own products?",
    answer:
      "The guard compares each proposal with an order ledger, so a different order means a different ledger. The live demo uses one fixed order, and we have only tested those three items.",
  },
  {
    question: "Is it only for e-commerce?",
    answer:
      "The demo is a packing station. The same idea (check an agent's proposal against what it sees and hears, using fixed rules) applies to other camera and voice workflows. We have only tested packing.",
  },
];
