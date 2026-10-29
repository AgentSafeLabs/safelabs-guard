// Accessible accordion on native <details>/<summary>: works without JS.
// The first item starts open.

import { ChevronDownIcon, ExternalIcon } from "@/components/icons";
import { FAQ } from "@/lib/home/faq";
import { BLOG_URL } from "@/lib/nav/links";

export default function Faq() {
  return (
    <div>
      <div className="divide-y divide-line overflow-hidden rounded-2xl border border-line bg-surface">
        {FAQ.map((item, i) => (
          <details key={item.question} open={i === 0} className="group" data-faq-item>
            <summary className="flex min-h-14 cursor-pointer items-center justify-between gap-4 px-4 py-3 text-left text-base font-semibold text-ink sm:px-5">
              <span>{item.question}</span>
              <ChevronDownIcon className="h-5 w-5 shrink-0 text-muted transition-transform group-open:rotate-180" />
            </summary>
            <p className="px-4 pb-4 text-base leading-relaxed text-soft sm:px-5">{item.answer}</p>
          </details>
        ))}
      </div>
      <p className="mt-4">
        <a
          href={BLOG_URL}
          target="_blank"
          rel="noopener noreferrer"
          className="inline-flex min-h-11 items-center gap-1.5 rounded-lg text-sm font-semibold text-accent underline underline-offset-4"
        >
          Read more on the Safe Labs blog
          <ExternalIcon className="h-3.5 w-3.5" />
        </a>
      </p>
    </div>
  );
}
