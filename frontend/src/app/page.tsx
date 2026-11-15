import { redirect } from "next/navigation";
import { homeRedirectPath } from "@/app/lib/authRedirects";

export default async function RootPage({
    searchParams,
}: {
    searchParams: Promise<Record<string, string | string[] | undefined>>;
}) {
    const params = await searchParams;
    const search = new URLSearchParams();
    for (const [key, value] of Object.entries(params)) {
        if (typeof value === "string") search.set(key, value);
        else if (Array.isArray(value) && value[0]) search.set(key, value[0]);
    }
    redirect(homeRedirectPath(search));
}
