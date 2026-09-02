import { useMemo, useState } from "react";
import { ExternalLink, Plus, ShoppingBag, Trash2, Wallet } from "lucide-react";
import { formatMoney, parseAmount } from "@/domain/money";
import {
  linkLabel,
  openWishlist,
  unpricedCount,
  wishlistTotalMinor,
  type WishlistItem,
} from "@/domain/wishlist";
import { cn } from "@/lib/cn";
import { useI18n } from "@/lib/i18n";
import { useStore } from "@/state/store";

/**
 * What the user means to buy, above the month they have to buy it from.
 *
 * It sits at the top of the budget on purpose. A shopping list in a notes app
 * is a list of things; here it is a number — "13.500 ₺ of intentions" — sitting
 * directly above what this month actually did, which is the only place that
 * comparison ever gets made.
 *
 * Nothing in it touches a total until the user says they bought something.
 * Wanting a thing has never made anybody poorer, and a budget that counted
 * wishes would be unusable within a week.
 */
export function Wishlist({ currency }: { currency: string }) {
  const { t } = useI18n();
  const items = useStore((s) => s.db.wishlist);
  const addWishlistItem = useStore((s) => s.addWishlistItem);
  const removeWishlistItem = useStore((s) => s.removeWishlistItem);
  const buyWishlistItem = useStore((s) => s.buyWishlistItem);

  const [title, setTitle] = useState("");
  const [price, setPrice] = useState("");
  const [url, setUrl] = useState("");

  const open = useMemo(() => openWishlist(items), [items]);
  const totalMinor = useMemo(() => wishlistTotalMinor(open), [open]);
  const unpriced = useMemo(() => unpricedCount(open), [open]);

  const submit = (event: React.FormEvent) => {
    event.preventDefault();
    const trimmed = title.trim();
    if (!trimmed) return;
    // A price is optional: half of what goes on a list like this is something
    // the user has not looked up yet, and demanding the number is how the
    // thing never gets written down at all.
    addWishlistItem({ title: trimmed, priceMinor: parseAmount(price), url });
    setTitle("");
    setPrice("");
    setUrl("");
  };

  return (
    <section className="card wishlist section">
      <div className="section-head">
        <h3>
          <ShoppingBag size={15} aria-hidden /> {t("wishlistTitle")}
        </h3>
        {open.length > 0 ? (
          <span className="wishlist-total mono" title={t("wishlistTotalHint")}>
            {formatMoney(totalMinor, currency)}
            {unpriced > 0 ? (
              <span className="faint"> · {t("wishlistUnpriced", { n: unpriced })}</span>
            ) : null}
          </span>
        ) : null}
      </div>

      <form className="wishlist-add" onSubmit={submit}>
        <input
          className="input grow"
          placeholder={t("wishlistName")}
          value={title}
          onChange={(e) => setTitle(e.target.value)}
        />
        <input
          className="input mono wishlist-price"
          inputMode="decimal"
          placeholder={t("wishlistPrice")}
          aria-label={t("wishlistPrice")}
          value={price}
          onChange={(e) => setPrice(e.target.value)}
        />
        <input
          className="input wishlist-link"
          placeholder={t("wishlistLink")}
          aria-label={t("wishlistLink")}
          value={url}
          onChange={(e) => setUrl(e.target.value)}
        />
        <button type="submit" className="btn primary" disabled={!title.trim()}>
          <Plus size={14} /> {t("add")}
        </button>
      </form>

      {open.length === 0 ? (
        <p className="faint wishlist-empty">{t("wishlistEmpty")}</p>
      ) : (
        <ul className="wishlist-rows">
          {open.map((item) => (
            <WishlistRow
              key={item.id}
              item={item}
              currency={currency}
              onBuy={() => buyWishlistItem(item.id)}
              onRemove={() => removeWishlistItem(item.id)}
            />
          ))}
        </ul>
      )}
    </section>
  );
}

function WishlistRow({
  item,
  currency,
  onBuy,
  onRemove,
}: {
  item: WishlistItem;
  currency: string;
  onBuy: () => void;
  onRemove: () => void;
}) {
  const { t } = useI18n();

  return (
    <li className="wishlist-row">
      <span className="wishlist-row-text">
        <span className="wishlist-row-title truncate">{item.title}</span>
        {item.url ? (
          /*
            `rel` is not decoration: this opens a page the user pasted from
            anywhere, and without it that page gets a handle on this window.
          */
          <a
            className="wishlist-row-link truncate"
            href={item.url}
            target="_blank"
            rel="noreferrer noopener"
          >
            <ExternalLink size={11} aria-hidden /> {linkLabel(item.url)}
          </a>
        ) : null}
      </span>

      <span className={cn("wishlist-row-price mono", item.priceMinor === null && "faint")}>
        {item.priceMinor === null
          ? t("wishlistNoPrice")
          : formatMoney(item.priceMinor, currency)}
      </span>

      {/* Buying is only offered once there is a figure to charge: an entry of
          "0 ₺" in the ledger is not a purchase, it is a mistake to correct. */}
      <button
        type="button"
        className="btn ghost icon sm"
        title={t("wishlistBuyHint")}
        aria-label={t("wishlistBuy")}
        disabled={item.priceMinor === null || item.priceMinor === 0}
        onClick={onBuy}
      >
        <Wallet size={14} />
      </button>
      <button
        type="button"
        className="btn ghost icon sm"
        title={t("wishlistRemove")}
        aria-label={t("wishlistRemove")}
        onClick={onRemove}
      >
        <Trash2 size={14} />
      </button>
    </li>
  );
}
