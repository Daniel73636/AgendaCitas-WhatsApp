import { WifiOff } from 'lucide-react';

export const metadata = { title: 'Sin conexion' };

export default function Offline() {
  return (
    <main className="mx-auto flex min-h-dvh max-w-md flex-col items-center justify-center gap-3 px-6 text-center">
      <WifiOff size={40} className="text-muted-foreground" />
      <h1 className="text-2xl font-bold">Sin conexion</h1>
      <p className="text-muted-foreground">No pudimos conectar con el servidor. Revisa tu internet; tu agenda se actualizara apenas vuelvas a estar en linea.</p>
    </main>
  );
}
