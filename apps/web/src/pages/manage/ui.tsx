import { useResource } from "../../shared/api";
import { Async, Heading, PageLink } from "../../shared/ui";
import { managementGroups } from "../../widgets/shell";
export function ManagePage() {
  const resource = useResource<{
    counts: {
      restaurants: string;
      orders: string;
      reviews: string;
      active: string;
    };
  }>("/bootstrap");
  return (
    <div className="manage-page">
      <Heading
        title="Огляд керування"
        description="Робота з доставкою, каталогом і даними сервісу."
      />
      <Async resource={resource} quiet>
        {({ counts }) => (
          <div className="manage-counts">
            <div>
              <span>Заклади</span>
              <strong>{counts.restaurants}</strong>
            </div>
            <div>
              <span>Замовлення</span>
              <strong>{counts.orders}</strong>
            </div>
            <div>
              <span>Активні</span>
              <strong>{counts.active}</strong>
            </div>
            <div>
              <span>Відгуки</span>
              <strong>{counts.reviews}</strong>
            </div>
          </div>
        )}
      </Async>
      {managementGroups.map((group) => (
        <section
          className="manage-section"
          key={group.label}
          aria-label={group.label}
        >
          <h2>{group.label}</h2>
          <div className="manage-section-grid">
            {group.links.map((section) => (
              <PageLink
                view={section.view}
                key={section.view}
                className="manage-section-link"
              >
                <span className="manage-section-arrow" aria-hidden="true">
                  ↗
                </span>
                <h3>{section.label}</h3>
                <p>{section.description}</p>
              </PageLink>
            ))}
          </div>
        </section>
      ))}
    </div>
  );
}
