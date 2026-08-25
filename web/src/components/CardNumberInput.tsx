import { useRef } from 'react';
import { formatCardNumber, MAX_DIGITS, toDigits } from '../core';

type Props = {
  id?: string;
  value: string;
  onChange: (digits: string) => void;
  placeholder?: string;
  /** Rendered inside the field on the right — usually the detected brand. */
  adornment?: React.ReactNode;
  autoFocus?: boolean;
};

/**
 * Card-number field that reformats as you type and holds the caret in place.
 * Grouping is cosmetic; nothing here decides a brand.
 */
export function CardNumberInput({
  id,
  value,
  onChange,
  placeholder = '4111 1111 1111 1111',
  adornment,
  autoFocus,
}: Props) {
  const inputRef = useRef<HTMLInputElement>(null);

  function handleChange(event: React.ChangeEvent<HTMLInputElement>) {
    const el = event.target;
    const caret = el.selectionStart ?? el.value.length;
    const inputType = (event.nativeEvent as InputEvent).inputType;

    let digitsBeforeCaret = el.value.slice(0, caret).replace(/\D/g, '').length;
    let next = toDigits(el.value);

    // Backspacing onto a separator space removes a character the user never
    // typed, so the digit count is unchanged and the field looks frozen. Take
    // the digit in front of the separator instead, which is what they meant.
    if (inputType === 'deleteContentBackward' && next.length === value.length && digitsBeforeCaret > 0) {
      next = next.slice(0, digitsBeforeCaret - 1) + next.slice(digitsBeforeCaret);
      digitsBeforeCaret -= 1;
    }

    onChange(next);

    const nextFormatted = formatCardNumber(next);
    let seen = 0;
    let nextCaret = nextFormatted.length;
    for (let i = 0; i < nextFormatted.length; i++) {
      if (seen === digitsBeforeCaret) {
        nextCaret = i;
        break;
      }
      if (/\d/.test(nextFormatted[i])) seen++;
    }
    requestAnimationFrame(() => el.setSelectionRange(nextCaret, nextCaret));
  }

  return (
    <div className="field">
      <input
        id={id}
        ref={inputRef}
        type="text"
        inputMode="numeric"
        autoComplete="off"
        autoCorrect="off"
        spellCheck={false}
        autoFocus={autoFocus}
        placeholder={placeholder}
        value={formatCardNumber(value)}
        onChange={handleChange}
      />
      {adornment ? (
        <span className="field__mark">{adornment}</span>
      ) : (
        value.length > 0 && (
          <span className="field__count">
            {value.length}/{MAX_DIGITS}
          </span>
        )
      )}
    </div>
  );
}
