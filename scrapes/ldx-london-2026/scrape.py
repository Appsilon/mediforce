import json, re
from bs4 import BeautifulSoup

soup = BeautifulSoup(open('/tmp/agenda.html', encoding='utf-8').read(), 'lxml')

def txt(el):
    return el.get_text(' ', strip=True) if el else ''

def paras(el):
    if not el:
        return ''
    ps = el.find_all('p')
    if ps:
        return '\n\n'.join(p.get_text(' ', strip=True) for p in ps if p.get_text(strip=True))
    return el.get_text(' ', strip=True)

sessions = []
seen = set()

day_wrappers = soup.select('.ld-agenda__day-wrapper')
# map each day wrapper to its day title via order
day_titles = [txt(t) for t in soup.select('.wp-block-pbc-single-day-tab, .wp-block-agenda-day-tab')]

for di, day in enumerate(day_wrappers):
    day_name = day_titles[di] if di < len(day_titles) else f"Day {di+1}"
    for track in day.select('.wp-block-pbc-agenda-single-track'):
        heading = track.select_one('.ld-agenda__heading')
        stage = txt(heading)
        for card in track.select('.ld-card--event-session'):
            modal = card.select_one('dialog.ld-card__modal')
            mid = modal.get('id') if modal else None
            key = (day_name, stage, mid, txt(card.select_one('.ld-card__title')))
            if key in seen:
                continue
            seen.add(key)

            title = txt(card.select_one('.ld-card__title'))
            stype = txt(card.select_one('.session-type'))
            time = ''
            if modal:
                time = txt(modal.select_one('.session-time'))
            if not time:
                time = txt(card.select_one('.ld-card__time'))

            # levels / suitable for
            levels = []
            src = modal if modal else card
            for lv in src.select('.session-level'):
                levels.append(txt(lv))
            if not levels:
                levels = [txt(s) for s in card.select('.session-levels span') if txt(s) != '•']

            # topics/tags from data attr on card
            topics = (card.get('data-tax-session-topic') or '').strip()
            topics = [t for t in topics.split(',') if t]

            # abstract: prefer modal post-content, fallback excerpt
            abstract = ''
            if modal:
                pc = modal.select_one('.ld-card__modal__post-content')
                abstract = paras(pc)
            if not abstract:
                abstract = paras(card.select_one('.ld-card__excerpt'))

            # speakers from modal (richest: includes bio)
            speakers = []
            if modal:
                for li in modal.select('.session-contributor, li'):
                    name_el = li.select_one('.session-contributor__name')
                    if not name_el:
                        continue
                    name = txt(name_el)
                    role = txt(li.select_one('.session-contributor__role'))
                    company = txt(li.select_one('.session-contributor__company'))
                    bios = li.select('.session-contributor__bio')
                    bio = ''
                    # second bio div holds the prose; first holds role/company
                    for b in bios:
                        if b.find('p'):
                            bio = paras(b)
                            break
                    link = li.select_one('.session-contributor__profile-link')
                    profile = link.get('href') if link else (name_el.find('a').get('href') if name_el.find('a') else '')
                    speakers.append({'name': name, 'role': role, 'company': company, 'bio': bio, 'profile': profile})
            # fallback to card contributors (no bio)
            if not speakers:
                for li in card.select('.ld-card__contributors-item'):
                    name = txt(li.select_one('.ld-card__contributors__item__name'))
                    if not name:
                        continue
                    role = txt(li.select_one('.ld-card__contributors__item__role'))
                    company = txt(li.select_one('.ld-card__contributors__item__company'))
                    link = li.select_one('a.contributor-credit__name') or li.select_one('a')
                    profile = link.get('href') if link else ''
                    speakers.append({'name': name, 'role': role, 'company': company, 'bio': '', 'profile': profile})

            sessions.append({
                'day': day_name, 'stage': stage, 'time': time, 'type': stype,
                'title': title, 'suitable_for': levels, 'topics': topics,
                'abstract': abstract, 'speakers': speakers,
            })

json.dump(sessions, open('/tmp/agenda.json','w'), ensure_ascii=False, indent=2)
print("TOTAL SESSIONS:", len(sessions))
from collections import Counter
print("BY DAY:", dict(Counter(s['day'] for s in sessions)))
print("BY TYPE:", dict(Counter(s['type'] for s in sessions)))
print("WITH ABSTRACT:", sum(1 for s in sessions if s['abstract']))
print("WITH SPEAKER:", sum(1 for s in sessions if s['speakers']))
print("WITH BIO:", sum(1 for s in sessions if any(sp['bio'] for sp in s['speakers'])))
print("\nSTAGES:")
for st in sorted(set(s['stage'] for s in sessions)):
    print(" -", st, "=", sum(1 for s in sessions if s['stage']==st))
