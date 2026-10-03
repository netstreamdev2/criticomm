import { listAvailableVehicles } from '@criticom/api';
import { getSession } from '@/lib/session';
import { assignVehicleAction } from '../actions';

export const dynamic = 'force-dynamic';
export const metadata = { title: 'Vehicle Selection · HikTech' };

export default async function VehicleSelectionPage() {
  const { supabase, silo } = await getSession();
  const vehicles = await listAvailableVehicles(supabase, silo === 'Ethekwini' ? 'MetroPolice' : silo);

  return (
    <div
      className="relative flex min-h-[calc(100vh-9rem)] items-start justify-center overflow-hidden rounded-xl bg-[#020b16] px-4 py-8 text-white sm:px-6 sm:py-12"
      style={{ backgroundImage: "linear-gradient(180deg, rgba(2, 9, 20, .38), rgba(2, 9, 20, .2) 45%, rgba(2, 9, 20, .48)), url('/shift-earth-network.png')", backgroundPosition: 'center', backgroundSize: 'cover' }}
    >
      <section className="relative w-full max-w-2xl rounded-2xl border border-white/15 bg-[#292b3b]/95 p-5 shadow-2xl backdrop-blur-md sm:p-9">
        <header className="mb-8 text-center">
          <h1 className="text-3xl font-bold tracking-tight sm:text-4xl">Select Your Unit</h1>
          <p className="mt-3 text-sm text-slate-300 sm:text-base">Please select the apparatus you will be operating for this shift.</p>
          <p className="mt-2 text-xs text-slate-400">Step 2 of 3 · {vehicles.length} vehicles available</p>
        </header>

        {vehicles.length === 0 && (
          <p className="rounded-xl border border-white/15 bg-[#182532] px-5 py-8 text-center text-slate-200">
            No vehicles available in your silo. Contact fleet control.
          </p>
        )}

        <div className="grid gap-4 sm:grid-cols-2 sm:gap-6">
          {vehicles.map((v) => (
            <form key={v.id} action={assignVehicleAction} className="flex min-h-64 flex-col items-center justify-between rounded-2xl border-2 border-[#38566b] bg-[#1b2835] px-4 py-6 text-center shadow-lg transition-colors hover:border-[#4e9bd0] focus-within:border-[#4e9bd0]">
              <input type="hidden" name="apparatus_id" value={v.id} />
              <div className="flex flex-col items-center">
                <svg aria-hidden="true" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8" className="mb-5 h-12 w-12 text-white">
                  <path d="M12 2 4 5v6c0 5.1 3.2 8.7 8 11 4.8-2.3 8-5.9 8-11V5l-8-3Z" />
                  <path d="M12 2v20" />
                </svg>
                <h2 className="text-xl font-bold">{v.unit_number}</h2>
                <p className="mt-1 text-slate-300">{v.name}</p>
                {(v.make || v.model || v.year) && (
                  <p className="mt-3 font-semibold">{[v.make, v.model, v.year ? `(${v.year})` : null].filter(Boolean).join(' ')}</p>
                )}
                {v.license_plate && <p className="mt-1 text-slate-300">{v.license_plate}</p>}
                <span className="mt-3 rounded-md bg-[#238bf2] px-2.5 py-0.5 text-xs font-bold uppercase tracking-wide text-white">{v.type}</span>
                {v.fuel_level && <p className="mt-2 text-xs text-slate-400">Fuel {v.fuel_level}</p>}
              </div>
              <button type="submit" className="mt-5 w-full rounded-lg bg-[#27c76f] px-4 py-2.5 font-semibold text-[#062014] transition-colors hover:bg-[#43df89] focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-white">
                Select Unit
              </button>
            </form>
          ))}
        </div>
      </section>
    </div>
  );
}
