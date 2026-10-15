import { ArrowLeft,Sparkles } from 'lucide-react';
import { legalDocuments,type LegalDocumentType } from '../data/legal';
import { Button } from '../ui';

interface LegalPageProps {
  documentType: LegalDocumentType;
  onHome: () => void;
}

export function LegalPage({ documentType, onHome }: LegalPageProps) {
  const document = legalDocuments[documentType];

  return (
    <main className="relative h-screen overflow-y-auto overflow-x-hidden scrollbar-gutter-stable">
      <div className="mx-auto w-full max-w-5xl px-6 py-5 lg:px-8">
        <header className="flex items-center justify-between gap-4">
          <button type="button" onClick={onHome} className="flex items-center gap-3 text-left">
            <div className="flex h-11 w-11 items-center justify-center rounded-2xl bg-gradient-to-br from-purple-600 to-blue-600 shadow-lg shadow-purple-500/25">
              <Sparkles className="h-5 w-5 text-white" />
            </div>
            <div>
              <p className="text-lg font-bold text-white">Lindyson AI</p>
              <p className="text-xs text-gray-500">AI 创作者工作台</p>
            </div>
          </button>

          <Button variant="secondary" size="md" icon={<ArrowLeft className="h-4 w-4" />} onClick={onHome}>
            返回首页
          </Button>
        </header>

        <section className="pt-14 pb-6 md:pt-18">
          <h1 className="text-4xl font-black leading-tight text-white md:text-5xl">{document.title}</h1>
          <p className="mt-5 max-w-3xl text-base leading-8 text-gray-300">{document.description}</p>
          <div className="mt-6 inline-flex rounded-lg border border-white/10 bg-white/5 px-4 py-2 text-sm font-semibold text-white">
            生效日期：{document.effectiveDate}
          </div>
        </section>

        <article className="mb-14 rounded-lg border border-white/10 bg-white/[0.04] px-5 py-2 shadow-2xl shadow-black/20 backdrop-blur md:px-8">
          {document.sections.map(section => (
            <section key={section.title} className="border-t border-white/10 py-7 first:border-t-0 md:py-8">
              <h2 className="text-xl font-bold leading-8 text-white">{section.title}</h2>
              <div className="mt-4 space-y-4 text-sm leading-7 text-gray-300 md:text-base md:leading-8">
                {section.paragraphs.map(paragraph => (
                  <p key={paragraph}>{paragraph}</p>
                ))}
                {section.bullets && (
                  <ul className="space-y-3">
                    {section.bullets.map(item => (
                      <li key={item} className="flex gap-3">
                        <span className="mt-3 h-1.5 w-1.5 flex-none rounded-full bg-purple-300" />
                        <span>{item}</span>
                      </li>
                    ))}
                  </ul>
                )}
              </div>
            </section>
          ))}
        </article>
      </div>
    </main>
  );
}
