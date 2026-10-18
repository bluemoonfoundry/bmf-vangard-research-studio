import { describe, expect, it, vi } from 'vitest';
import { render } from '@testing-library/react';
import { SearchSuggestions } from '@/components/chat/SearchSuggestions';

const HTML = '<style>.c{color:red}</style><div class="c"><a href="https://www.google.com/search?q=x"><span>x query</span></a></div>';

describe('SearchSuggestions', () => {
  it('renders inside a shadow root', () => {
    const { container } = render(<SearchSuggestions html={HTML} onOpenLink={() => {}} />);
    const host = container.querySelector('[data-testid="search-suggestions"]') as HTMLElement;
    expect(host.shadowRoot).not.toBeNull();
    expect(host.shadowRoot!.querySelector('style')).not.toBeNull();
    expect(host.shadowRoot!.querySelector('a')?.textContent).toBe('x query');
    expect(container.querySelector('iframe')).toBeNull();
    expect(host.querySelector('a')).toBeNull();
  });

  it('clicking a suggestion opens it externally and does not navigate', () => {
    const onOpenLink = vi.fn();
    const { container } = render(<SearchSuggestions html={HTML} onOpenLink={onOpenLink} />);
    const host = container.querySelector('[data-testid="search-suggestions"]') as HTMLElement;
    const ev = new MouseEvent('click', { bubbles: true, cancelable: true, composed: true });
    host.shadowRoot!.querySelector('span')!.dispatchEvent(ev);
    expect(ev.defaultPrevented).toBe(true);
    expect(onOpenLink).toHaveBeenCalledWith('https://www.google.com/search?q=x');
  });

  it('contains the host so provider CSS cannot overlay the app', () => {
    const { container } = render(<SearchSuggestions html={HTML} onOpenLink={() => {}} />);
    const host = container.querySelector('[data-testid="search-suggestions"]') as HTMLElement;
    expect(host.style.position).toBe('relative');
    expect(host.style.overflow).toBe('hidden');
    expect(host.style.contain).toBe('content');
  });

  it('keeps @import/url() only as inert style text inside the shadow root (CSP is the network guard)', () => {
    const css = '@import url(https://x.test/a.css);.c{background:url(https://x.test/i.png)}';
    const { container } = render(<SearchSuggestions html={`<style>${css}</style><div class="c">q</div>`} onOpenLink={() => {}} />);
    const host = container.querySelector('[data-testid="search-suggestions"]') as HTMLElement;
    expect(host.shadowRoot!.querySelector('style')?.textContent).toContain('@import');
    expect(host.querySelector('style')).toBeNull();
    expect(document.querySelector('link')).toBeNull();
  });

  it('renders nothing for empty sanitized content', () => {
    const { container } = render(<SearchSuggestions html="" onOpenLink={() => {}} />);
    expect(container.firstChild).toBeNull();
  });
});
