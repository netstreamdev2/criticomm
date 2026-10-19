import { ox } from './styles';

/**
 * The old system's "Staff no." box: type the number, or pick "number — name"
 * from the list. The server turns it back into the member.
 */
export function MemberInput({
  id, name = 'member', people, placeholder, required = true, defaultValue,
}: {
  id: string;
  name?: string;
  people: Array<{ badge: string | null; name: string }>;
  placeholder: string;
  required?: boolean;
  defaultValue?: string;
}) {
  return (
    <>
      <input id={id} name={name} list={`${id}-list`} required={required} autoComplete="off" placeholder={placeholder}
        defaultValue={defaultValue} className={ox.input} />
      <datalist id={`${id}-list`}>
        {people.filter((p) => p.badge).map((p) => <option key={`${p.badge}-${p.name}`} value={`${p.badge} — ${p.name}`} />)}
      </datalist>
    </>
  );
}
