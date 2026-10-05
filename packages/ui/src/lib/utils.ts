// shadcn-style class helper. This project doesn't compile Tailwind (the apps use plain CSS),
// so there is nothing to merge; this just joins truthy class names. If Tailwind/shadcn is set
// up later, swap in `twMerge(clsx(inputs))` from `clsx` + `tailwind-merge`.
export function cn(...inputs: Array<string | false | null | undefined>) {
  return inputs.filter(Boolean).join(" ");
}
