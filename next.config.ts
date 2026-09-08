import type { NextConfig } from "next";

const nextConfig: NextConfig = {
  /*
    The map route stats the basemap archives to decide which fallback it is on.
    Without this exclude the tracer pulls `public/basemap/**` into the server
    bundle, and the two fetched archives are 177 MB and 36 MB. They are static
    assets served over HTTP by the pmtiles range reader and are never read by
    server code, so nothing needs them in the bundle.
  */
  outputFileTracingExcludes: {
    '**': ['public/basemap/**', 'public/maplibre/**', 'data/**'],
  },
};

export default nextConfig;
