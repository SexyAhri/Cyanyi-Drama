"use client";

import * as React from "react";
import { cn } from "@/lib/utils";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "./select";

type NativeSelectProps = Omit<
  React.ComponentProps<"select">,
  "size" | "multiple"
> & {
  size?: "sm" | "default";
};

type Choice = { value: string; label: React.ReactNode; disabled: boolean };
function getChoices(
  children: React.ReactNode,
  groupDisabled = false,
): Choice[] {
  return React.Children.toArray(children).flatMap((child) => {
    if (
      !React.isValidElement<{
        value?: string | number;
        children?: React.ReactNode;
        disabled?: boolean;
      }>(child)
    )
      return [];
    if (
      child.type === React.Fragment ||
      child.type === "optgroup" ||
      child.type === NativeSelectOptGroup
    )
      return getChoices(
        child.props.children,
        groupDisabled || Boolean(child.props.disabled),
      );
    if (child.type !== "option" && child.type !== NativeSelectOption) return [];
    return [
      {
        value: String(child.props.value ?? ""),
        label: child.props.children,
        disabled: groupDisabled || Boolean(child.props.disabled),
      },
    ];
  });
}

function NativeSelect({
  className,
  style,
  size = "default",
  children,
  value,
  defaultValue,
  disabled,
  id,
  title,
  "aria-label": ariaLabel,
  "aria-labelledby": ariaLabelledBy,
  "aria-describedby": ariaDescribedBy,
  "aria-invalid": ariaInvalid,
  required,
  ...props
}: NativeSelectProps) {
  const choices = getChoices(children);
  const [draft, setDraft] = React.useState(() =>
    String(
      defaultValue ?? choices.find((choice) => !choice.disabled)?.value ?? "",
    ),
  );
  const selectedValue = value === undefined ? draft : String(value);
  const selected = choices.find((choice) => choice.value === selectedValue);
  const field = React.useRef<HTMLSelectElement | null>(null);
  return (
    <>
      <Select
        disabled={disabled}
        required={required}
        value={selectedValue}
        onValueChange={(next) => {
          if (next === null || next === selectedValue) return;
          if (value === undefined) setDraft(next);
          // Preserve native form values and React change events for existing callers.
          if (field.current) {
            field.current.value = next;
            field.current.dispatchEvent(new Event("change", { bubbles: true }));
          }
        }}
      >
        <SelectTrigger
          id={id}
          aria-label={ariaLabel}
          aria-labelledby={ariaLabelledBy}
          aria-describedby={ariaDescribedBy}
          aria-invalid={ariaInvalid}
          title={title}
          style={style}
          size={size}
          className={cn("min-w-0 w-full max-w-full text-xs", className)}
        >
          <SelectValue>
            <span className="min-w-0 flex-1 truncate">{selected?.label}</span>
          </SelectValue>
        </SelectTrigger>
        <SelectContent
          align="start"
          alignItemWithTrigger={false}
          className="min-w-0"
        >
          {choices.map((choice) => (
            <SelectItem
              key={choice.value}
              value={choice.value}
              disabled={choice.disabled}
              className="min-w-0 text-xs leading-5"
            >
              <span className="min-w-0 flex-1 whitespace-normal break-words">
                {choice.label}
              </span>
            </SelectItem>
          ))}
        </SelectContent>
      </Select>
      <select
        {...props}
        ref={field}
        hidden
        aria-hidden="true"
        tabIndex={-1}
        disabled={disabled}
        value={selectedValue}
      >
        {children}
      </select>
    </>
  );
}

function NativeSelectOption(props: React.ComponentProps<"option">) {
  return <option {...props} />;
}
function NativeSelectOptGroup(props: React.ComponentProps<"optgroup">) {
  return <optgroup {...props} />;
}
export { NativeSelect, NativeSelectOptGroup, NativeSelectOption };
