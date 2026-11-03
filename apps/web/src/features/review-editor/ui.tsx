import type { Review, ReviewOption } from "../../entities/review";
import { api, useResource } from "../../shared/api";
import {
  Async,
  Empty,
  Field,
  AppForm,
  numberValue,
  textValue,
} from "../../shared/ui";

export function ReviewEditor({
  review,
  orderId,
  onSaved,
}: {
  review?: Review;
  orderId?: number;
  onSaved: () => void;
}) {
  const resource = useResource<ReviewOption[]>(
    review ? null : "/review-options",
  );
  if (review) return <ReviewForm review={review} onSaved={onSaved} />;
  return (
    <Async resource={resource}>
      {(options) =>
        options.some((item) => orderId === undefined || item.id === orderId) ? (
          <ReviewForm
            options={
              orderId === undefined
                ? options
                : options.filter((item) => item.id === orderId)
            }
            orderId={orderId}
            onSaved={onSaved}
          />
        ) : (
          <Empty
            title="Немає доставлених замовлень без відгуку"
            hint="Після доставки замовлення можна залишити один відгук"
          />
        )
      }
    </Async>
  );
}
function ReviewForm({
  review,
  orderId,
  options = [],
  onSaved,
}: {
  review?: Review;
  orderId?: number;
  options?: ReviewOption[];
  onSaved: () => void;
}) {
  return (
    <AppForm
      submitLabel={review ? "Зберегти" : "Додати відгук"}
      onSubmit={(data) =>
        api.write(
          `/reviews${review ? `/${review.id}` : ""}`,
          review ? "PATCH" : "POST",
          {
            rating: numberValue(data, "rating"),
            comment: textValue(data, "comment"),
            ...(!review ? { order_id: numberValue(data, "order_id") } : {}),
          },
        )
      }
      onSuccess={onSaved}
    >
      {review ? (
        <p>
          {review.restaurant} · замовлення № {review.order_id}
        </p>
      ) : orderId ? (
        <>
          <input type="hidden" name="order_id" value={orderId} />
          <p>
            Замовлення № {orderId} · {options[0]?.restaurant}
          </p>
        </>
      ) : (
        <Field
          name="order_id"
          label="Виконане замовлення"
          defaultValue={orderId ?? options[0]?.id}
          options={options.map((item) => ({
            value: item.id,
            label: `№ ${item.id} · ${item.restaurant} · ${item.customer}`,
          }))}
        />
      )}
      <Field
        name="rating"
        label="Оцінка"
        defaultValue={review?.rating ?? 5}
        options={[5, 4, 3, 2, 1].map((value) => ({
          value,
          label: `${value} / 5`,
        }))}
      />
      <Field
        name="comment"
        label="Коментар"
        type="textarea"
        maxLength={2000}
        defaultValue={review?.comment}
      />
    </AppForm>
  );
}
