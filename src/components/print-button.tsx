"use client";

/** Abre a impressão do navegador; lá a pessoa escolhe "Salvar como PDF". */
export default function PrintButton({ fileName, label = "Exportar PDF" }: { fileName: string; label?: string }) {
  return (
    <button
      type="button"
      className="btn"
      onClick={() => {
        // O título da página vira o nome sugerido do arquivo PDF.
        const previous = document.title;
        document.title = fileName;
        window.addEventListener("afterprint", () => (document.title = previous), { once: true });
        window.print();
      }}
    >
      {label}
    </button>
  );
}
