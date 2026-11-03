import { useEffect } from "react";
import type { Page } from "../../shared/lib";
import type { Review } from "../../entities/review";
import type { DialogState } from "../../widgets/workspace-dialog";
import { useResource } from "../../shared/api";
import { dateTime, navigate, useLocationParams } from "../../shared/lib";
import { Async, Empty, Heading, Pagination } from "../../shared/ui";

export function ReviewsPage({
  onDialog,
}: {
  onDialog: (state: DialogState) => void;
}) {
  const params = useLocationParams(),
    page = params.get("page") ?? "1";
  const resource = useResource<Page<Review>>(
    `/reviews?page=${encodeURIComponent(page)}`,
  );
  useEffect(() => {
    if (resource.data && Number(page) !== resource.data.page)
      navigate({ page: resource.data.page }, true);
  }, [resource.data, page]);
  return (
    <>
      <Heading
        title="Відгуки клієнтів"
        description="Оцінки ресторанів після виконаних замовлень."
      >
        <button
          className="primary"
          onClick={() => onDialog({ type: "review" })}
        >
          Додати відгук
        </button>
      </Heading>
      <Async resource={resource}>
        {(data) => (
          <>
            {data.items.length ? (
              <div className="panel">
                {data.items.map((review) => (
                  <article className="review" key={review.id}>
                    <div className="page-heading">
                      <div>
                        <h3>{review.restaurant}</h3>
                        <div className="review-meta">
                          <span>{review.customer}</span>
                          <span>Замовлення № {review.order_id}</span>
                          <span>{dateTime(review.created_at)}</span>
                        </div>
                      </div>
                      <span className="rating">{review.rating} / 5</span>
                    </div>
                    <p>{review.comment}</p>
                    <div className="actions">
                      <button
                        className="text-button"
                        onClick={() => onDialog({ type: "review", review })}
                      >
                        Редагувати
                      </button>
                      <button
                        className="text-button danger-text"
                        onClick={() =>
                          onDialog({ type: "delete-review", review })
                        }
                      >
                        Видалити
                      </button>
                    </div>
                  </article>
                ))}
              </div>
            ) : (
              <Empty
                title="Відгуків ще немає"
                hint="Відгук можна залишити після доставки замовлення"
              />
            )}
            <Pagination
              data={data}
              onPage={(value) => navigate({ page: value })}
            />
          </>
        )}
      </Async>
    </>
  );
}
