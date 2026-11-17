// «Отмеченные»: объявления с отметкой или заметкой и отдельное окно скрытых.
import { useState } from 'react';
import { Bookmark, EyeOff } from 'lucide-react';
import { api, Listing, t, useLoad } from '../core';
import { Empty, Loading, Tabs } from '../ui';
import { ListingCard } from '../listing';

export default function MarkedPage() {
  const [tab, setTab] = useState('marked');
  const { data, loading, reload } = useLoad(() => api<Listing[]>(`/marks${tab === 'hidden' ? '?hidden=1' : ''}`), [tab]);
  return (
    <div className="stack">
      <h1 className="page-title">{t('Отмеченные')}</h1>
      <Tabs items={[{ value: 'marked', label: t('Отмеченные и заметки') }, { value: 'hidden', label: t('Скрытые') }]} value={tab} onChange={setTab} />
      {loading ? <Loading /> : (
        <div className="list">
          {data?.map((l) => <ListingCard key={l.id} l={l} onChange={reload} />)}
          {data?.length === 0 && (
            <div className="card">
              {tab === 'marked'
                ? <Empty icon={<Bookmark size={26} />} title={t('Нет отмеченных объявлений')} text={t('Отмечайте объявления и пишите к ним заметки через меню «Действия», чтобы вернуться позже.')} />
                : <Empty icon={<EyeOff size={26} />} title={t('Скрытых объявлений нет')} text={t('Скрытые объявления не показываются в поиске. Здесь их можно вернуть.')} />}
            </div>
          )}
        </div>
      )}
    </div>
  );
}
